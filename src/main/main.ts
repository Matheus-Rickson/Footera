import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { listClubs } from '../services/worldService.ts';
import { createProfile, listProfiles } from '../services/profileService.node.ts';
import {
  advanceCareer, createCareerSave, getCalendar, getReport, getRound, getTable, listCareerSaves, listCompetitionsFor, openCareer,
  simulateCareerMatchday, previewCareerLiveMatch, finishCareerLiveMatch, getFinance, getTransfers, searchTransferMarket, sendTransferOffer, getTransferNegotiation, proposeTransferFee, answerTransferOffer, listPlayerForSale, getTactics, saveTacticScheme, duplicateTacticScheme, deleteTacticScheme, activateTacticScheme, getAutoLineup,
  getSeason, beginNextSeason, listContracts, offerRenewal, listNews, careerHistory, trophyRoom,
  getBoard, answerJobOffer, askBudget,
  getTraining, setTrainingIntensity, setTrainingDelegated, setTrainingFocus, setTrainingRoleFocus, getStaff, hireStaffFor, fireStaffFor, getMedical, getInfrastructure, startUpgradeFor,
  playerProfile, getScouting, hireScoutFor, fireScoutFor, assignScoutFor, shortlistFor, getYouth, promoteYouthFor, releaseYouthFor,
} from '../services/saveService.node.ts';
import { ValidationError } from '../services/careerService.ts';
import { UserError } from '../shared/errors.ts';
import { ImageError, inspectImage, MAX_PHOTO_BYTES } from '../shared/photo.ts';
import type { IpcResult, MarketFilter, OfferInput, PhotoPick, RenewInput, SchemeInput } from '../shared/api.ts';
import { baseUniverse, setBaseUniverseDir } from '../services/universeService.node.ts';

// O nome do produto (FOOTERA) não muda a pasta dos saves: o app instalado usa a mesma pasta de sempre,
// senão carreiras criadas antes da troca de nome sumiriam da lista.
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'football-manager-simulator'));
const dataDir = () => path.join(app.getPath('userData'), 'data');
// base de dados fixa distribuída com o jogo (no app instalado fica dentro do app.asar; o fs do Electron lê de lá)
setBaseUniverseDir(path.join(app.getAppPath(), 'data', 'base'));
const uuid = z.string().uuid();

/** Fotos escolhidas aguardando a criação da carreira. O renderer só conhece o token, nunca o caminho. */
const pendingPhotos = new Map<string, Uint8Array>();
const MAX_PENDING = 8;

function handle<I, T>(channel: string, schema: z.ZodType<I, z.ZodTypeDef, unknown>, fn: (input: I) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join('; ') };
    try { return { ok: true, data: await fn(parsed.data) }; }
    catch (err) {
      if (err instanceof ValidationError || err instanceof ImageError || err instanceof UserError) return { ok: false, error: err.message };
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: `Erro inesperado: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

function registerHandlers(): void {
  handle('app:info', z.unknown(), () => ({ dataDir: dataDir(), version: app.getVersion() }));
  handle('profile:list', z.unknown(), () => listProfiles(dataDir()));
  handle('profile:create', z.object({ name: z.string().max(200) }), (i) => createProfile(dataDir(), i.name));
  handle('world:clubs', z.unknown(), () => listClubs(baseUniverse().world));

  handle('photo:pick', z.unknown(), async (): Promise<PhotoPick | null> => {
    const opts: OpenDialogOptions = {
      title: 'Escolher foto do treinador', properties: ['openFile'],
      filters: [{ name: 'Imagens PNG ou JPEG', extensions: ['png', 'jpg', 'jpeg'] }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    if (fs.statSync(file).size > MAX_PHOTO_BYTES) throw new ValidationError(`A imagem excede o limite de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    const bytes = new Uint8Array(fs.readFileSync(file));
    const info = inspectImage(bytes);
    const token = randomUUID();
    pendingPhotos.set(token, bytes);
    while (pendingPhotos.size > MAX_PENDING) pendingPhotos.delete(pendingPhotos.keys().next().value as string);
    const mime = info.format === 'png' ? 'image/png' : 'image/jpeg';
    return {
      token, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      width: info.width, height: info.height, format: info.format, bytes: info.bytes, fileName: path.basename(file),
    };
  });
  handle('photo:discard', z.object({ token: uuid }), (i) => { pendingPhotos.delete(i.token); return true as const; });

  const coach = z.object({
    firstName: z.string().trim().min(1).max(40), lastName: z.string().trim().min(1).max(40),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nationality: z.string().regex(/^[A-Z]{3}$/),
    methodology: z.enum(['defensive', 'possession', 'aggressive']),
    attributes: z.object({
      tactics: z.number().int().min(1).max(20), motivation: z.number().int().min(1).max(20), youth: z.number().int().min(1).max(20),
      discipline: z.number().int().min(1).max(20), negotiation: z.number().int().min(1).max(20), adaptability: z.number().int().min(1).max(20),
    }).strict(),
  });
  handle('career:create', z.object({
    profileId: uuid, clubId: z.string().min(1).max(60), coach, photoToken: uuid.nullable(), fullLeagues: z.array(z.string().min(1).max(60)).max(200),
  }), async (i) => {
    let photo: Uint8Array | undefined;
    if (i.photoToken) {
      photo = pendingPhotos.get(i.photoToken);
      if (!photo) throw new ValidationError('A foto selecionada expirou. Escolha a imagem novamente.');
    }
    const created = await createCareerSave(dataDir(), { profileId: i.profileId, clubId: i.clubId, coach: i.coach, photo, fullLeagues: i.fullLeagues });
    if (i.photoToken) pendingPhotos.delete(i.photoToken);
    return created;
  });
  handle('career:list', z.object({ profileId: uuid }), (i) => listCareerSaves(dataDir(), i.profileId));
  handle('career:open', z.object({ profileId: uuid, careerId: uuid }), (i) => openCareer(dataDir(), i.profileId, i.careerId));
  const ref = z.object({ profileId: uuid, careerId: uuid });
  handle('career:calendar', ref, (i) => getCalendar(dataDir(), i.profileId, i.careerId));
  handle('career:competitions', ref, (i) => listCompetitionsFor(dataDir(), i.profileId, i.careerId));
  handle('career:table', ref.extend({ competitionId: z.string().min(1).max(100) }), (i) => getTable(dataDir(), i.profileId, i.careerId, i.competitionId));
  handle('career:advance', ref.extend({ mode: z.enum(['day', 'nextMatchday']) }), (i) => advanceCareer(dataDir(), i.profileId, i.careerId, i.mode));
  handle('career:simulate', ref, (i) => simulateCareerMatchday(dataDir(), i.profileId, i.careerId));
  const liveSchema = ref.extend({ live: z.object({
    interventions: z.array(z.discriminatedUnion('kind', [
      z.object({ tick: z.number().int().min(0).max(400), kind: z.literal('sub'), out: z.string().min(1).max(60), in: z.string().min(1).max(60), slot: z.enum(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST']).optional(), reshape: z.boolean().optional() }),
      z.object({ tick: z.number().int().min(0).max(400), kind: z.literal('talk'), tone: z.enum(['incentivar', 'cobrar', 'encorajar', 'consolar']) }),
    ])).max(12),
    controlUntil: z.number().int().min(0).max(400).nullable(),
  }) });
  handle('career:live-preview', liveSchema, (i) => previewCareerLiveMatch(dataDir(), i.profileId, i.careerId, i.live));
  handle('career:live-finish', liveSchema, (i) => finishCareerLiveMatch(dataDir(), i.profileId, i.careerId, i.live));
  handle('career:match', ref.extend({ fixtureId: z.string().min(1).max(200) }), (i) => getReport(dataDir(), i.profileId, i.careerId, i.fixtureId));
  handle('career:round', ref.extend({ competitionId: z.string().min(1).max(100), round: z.number().int().min(1).max(200) }),
    (i) => getRound(dataDir(), i.profileId, i.careerId, i.competitionId, i.round));
  const settings = z.object({
    mentality: z.enum(['defensive', 'balanced', 'attacking']), buildUp: z.enum(['short', 'mixed', 'long']),
    tempo: z.number().int().min(1).max(5), width: z.number().int().min(1).max(5), defensiveLine: z.number().int().min(1).max(5), pressing: z.number().int().min(1).max(5),
  });
  const schemeId = ref.extend({ schemeId: z.string().min(1).max(60) });
  handle('transfers:get', ref, (i) => getTransfers(dataDir(), i.profileId, i.careerId));
  handle('transfers:search', ref.extend({ filter: z.object({
    position: z.enum(['GK', 'DEF', 'MID', 'ATT', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST']).optional(),
    minAge: z.number().int().min(14).max(50).optional(), maxAge: z.number().int().min(14).max(50).optional(),
    maxValue: z.number().int().min(0).max(1e10).optional(), name: z.string().max(40).optional(), freeOnly: z.boolean().optional(),
    positions: z.array(z.enum(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST'])).max(16).optional(), naturalOnly: z.boolean().optional(),
    nationalities: z.array(z.string().max(8)).max(100).optional(), foot: z.enum(['right', 'left', 'both']).optional(),
    maxWage: z.number().int().min(0).max(1e9).optional(), contractEndsBy: z.enum(['season', 'next']).optional(),
    clubOnly: z.boolean().optional(), shortlistedOnly: z.boolean().optional(), knownOnly: z.boolean().optional(),
    offset: z.number().int().min(0).max(1e6).optional(), limit: z.number().int().min(1).max(500).optional(),
  }) }), (i) => searchTransferMarket(dataDir(), i.profileId, i.careerId, i.filter as MarketFilter));
  handle('transfers:offer', ref.extend({ offer: z.object({
    playerId: z.string().min(1).max(60), fee: z.number().int().min(0).max(1e10), wage: z.number().int().min(1).max(1e9), years: z.number().int().min(1).max(5),
  }) }), (i) => sendTransferOffer(dataDir(), i.profileId, i.careerId, i.offer as OfferInput));
  handle('transfers:negotiation', ref.extend({ playerId: z.string().min(1).max(60) }), (i) => getTransferNegotiation(dataDir(), i.profileId, i.careerId, i.playerId));
  handle('transfers:fee', ref.extend({ playerId: z.string().min(1).max(60), fee: z.number().int().min(0).max(1e10) }), (i) => proposeTransferFee(dataDir(), i.profileId, i.careerId, i.playerId, i.fee));
  handle('transfers:respond', ref.extend({ offerId: z.number().int().positive(), accept: z.boolean() }), (i) => answerTransferOffer(dataDir(), i.profileId, i.careerId, i.offerId, i.accept));
  handle('transfers:list', ref.extend({ playerId: z.string().min(1).max(60), listed: z.boolean() }), (i) => listPlayerForSale(dataDir(), i.profileId, i.careerId, i.playerId, i.listed));
  handle('finance:get', ref, (i) => getFinance(dataDir(), i.profileId, i.careerId));
  handle('tactics:get', ref, (i) => getTactics(dataDir(), i.profileId, i.careerId));
  handle('tactics:save', ref.extend({ scheme: z.object({
    id: z.string().max(60).nullable().optional(), name: z.string().max(200), formation: z.string().max(80), settings, lineup: z.array(z.string().max(60)).length(11).nullable(),
    roles: z.array(z.string().max(40).nullable()).length(11).nullable().optional(),
  }) }), (i) => saveTacticScheme(dataDir(), i.profileId, i.careerId, i.scheme as SchemeInput));
  handle('tactics:duplicate', schemeId, (i) => duplicateTacticScheme(dataDir(), i.profileId, i.careerId, i.schemeId));
  handle('tactics:delete', schemeId, (i) => deleteTacticScheme(dataDir(), i.profileId, i.careerId, i.schemeId));
  handle('tactics:activate', schemeId, (i) => activateTacticScheme(dataDir(), i.profileId, i.careerId, i.schemeId));
  handle('tactics:auto', ref.extend({ formation: z.string().max(80) }), (i) => getAutoLineup(dataDir(), i.profileId, i.careerId, i.formation));
  handle('season:status', ref, (i) => getSeason(dataDir(), i.profileId, i.careerId));
  handle('season:start', ref, (i) => beginNextSeason(dataDir(), i.profileId, i.careerId));
  handle('contracts:list', ref, (i) => listContracts(dataDir(), i.profileId, i.careerId));
  handle('contracts:renew', ref.extend({ input: z.object({
    playerId: z.string().min(1).max(60), wage: z.number().int().min(1).max(1e9), years: z.number().int().min(1).max(5),
  }) }), (i) => offerRenewal(dataDir(), i.profileId, i.careerId, i.input as RenewInput));
  handle('news:list', ref, (i) => listNews(dataDir(), i.profileId, i.careerId));
  handle('career:history', ref, (i) => careerHistory(dataDir(), i.profileId, i.careerId));
  handle('career:trophies', ref, (i) => trophyRoom(dataDir(), i.profileId, i.careerId));
  const id60 = z.string().min(1).max(60);
  handle('scouting:get', ref, (i) => getScouting(dataDir(), i.profileId, i.careerId));
  handle('scouting:hire', ref.extend({ candidateId: id60 }), (i) => hireScoutFor(dataDir(), i.profileId, i.careerId, i.candidateId));
  handle('scouting:fire', ref.extend({ scoutId: id60 }), (i) => fireScoutFor(dataDir(), i.profileId, i.careerId, i.scoutId));
  handle('scouting:assign', ref.extend({ scoutId: id60, assignment: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('shortlist') }), z.object({ kind: z.literal('country'), countryCode: z.string().regex(/^[A-Z]{3}$/) }),
  ]) }), (i) => assignScoutFor(dataDir(), i.profileId, i.careerId, i.scoutId, i.assignment));
  handle('scouting:shortlist', ref.extend({ playerId: id60, on: z.boolean() }), (i) => shortlistFor(dataDir(), i.profileId, i.careerId, i.playerId, i.on));
  handle('player:profile', ref.extend({ playerId: id60 }), (i) => playerProfile(dataDir(), i.profileId, i.careerId, i.playerId));
  handle('youth:get', ref, (i) => getYouth(dataDir(), i.profileId, i.careerId));
  handle('youth:promote', ref.extend({ playerId: id60 }), (i) => promoteYouthFor(dataDir(), i.profileId, i.careerId, i.playerId));
  handle('youth:release', ref.extend({ playerId: id60 }), (i) => releaseYouthFor(dataDir(), i.profileId, i.careerId, i.playerId));
  handle('training:get', ref, (i) => getTraining(dataDir(), i.profileId, i.careerId));
  handle('training:intensity', ref.extend({ intensity: z.enum(['light', 'normal', 'hard']) }), (i) => setTrainingIntensity(dataDir(), i.profileId, i.careerId, i.intensity));
  handle('training:delegate', ref.extend({ on: z.boolean() }), (i) => setTrainingDelegated(dataDir(), i.profileId, i.careerId, i.on));
  handle('training:focus', ref.extend({ playerId: id60, focus: z.enum(['balanced', 'finishing', 'creation', 'defense', 'physical', 'technical', 'goalkeeping']) }),
    (i) => setTrainingFocus(dataDir(), i.profileId, i.careerId, i.playerId, i.focus));
  handle('training:roleFocus', ref.extend({ playerId: id60, roleId: z.string().min(1).max(40).nullable() }),
    (i) => setTrainingRoleFocus(dataDir(), i.profileId, i.careerId, i.playerId, i.roleId));
  handle('staff:get', ref, (i) => getStaff(dataDir(), i.profileId, i.careerId));
  handle('staff:hire', ref.extend({ candidateId: id60 }), (i) => hireStaffFor(dataDir(), i.profileId, i.careerId, i.candidateId));
  handle('staff:fire', ref.extend({ staffId: id60 }), (i) => fireStaffFor(dataDir(), i.profileId, i.careerId, i.staffId));
  handle('medical:get', ref, (i) => getMedical(dataDir(), i.profileId, i.careerId));
  handle('infra:get', ref, (i) => getInfrastructure(dataDir(), i.profileId, i.careerId));
  handle('infra:upgrade', ref.extend({ kind: z.enum(['training', 'youth', 'medical', 'stadium']) }), (i) => startUpgradeFor(dataDir(), i.profileId, i.careerId, i.kind));
  handle('board:get', ref, (i) => getBoard(dataDir(), i.profileId, i.careerId));
  handle('board:job', ref.extend({ offerId: z.number().int().positive(), accept: z.boolean() }), (i) => answerJobOffer(dataDir(), i.profileId, i.careerId, i.offerId, i.accept));
  handle('board:budget', ref.extend({ kind: z.enum(['transfer', 'wage']) }), (i) => askBudget(dataDir(), i.profileId, i.careerId, i.kind));
  handle('app:quit', z.unknown(), () => { setImmediate(() => app.quit()); return true as const; });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640, backgroundColor: '#161718', title: 'FOOTERA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL;
    if (!url.startsWith('file://') && !(dev && url.startsWith(dev))) e.preventDefault();
  });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) void win.loadURL(dev); else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
