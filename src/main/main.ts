import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { listClubs } from '../services/worldService.ts';
import { createProfile, listProfiles } from '../services/profileService.node.ts';
import {
  advanceCareer, careerSaveFile, closeAllCareerDbs, continueCareerDay, deleteCareerSave, createCareerSave, getLeaders, getCalendar, getReport, getRound, getTable, listCareerSaves, listCompetitionsFor, openCareer,
  simulateCareerMatchday, previewCareerLiveMatch, finishCareerLiveMatch, getFinance, financeLedger, sponsorNegotiate, sponsorAccept, sponsorTerminate, sponsorSearch, getTransfers, searchTransferMarket, sendTransferOffer, getTransferNegotiation, proposeTransferFee, answerTransferOffer, answerWithCounterOffer, rescindContract, listPlayerForSale, getTactics, saveTacticScheme, duplicateTacticScheme, deleteTacticScheme, activateTacticScheme, getAutoLineup,
  getSeason, beginNextSeason, listContracts, offerRenewal, listNews, socialFeed, markInboxRead, careerHistory, trophyRoom,
  getBoard, coachCareer, enrollLicenseFor, answerJobOffer, askBudget, spendCoachPointFor, clubInfo, clubProfile, conversations, playerTalk, boardTalk, aiCoachInfo, unemployedCoaches, cupBracket, stagedView,
  getTraining, setTrainingIntensity, setTrainingDelegated, setTrainingFocus, setTrainingRoleFocus, setTrainingWeekSession, applyTrainingTemplate, setTrainingAutoAdjust, setTrainingGkSession, getStaff, hireStaffFor, fireStaffFor, getMedical, getInfrastructure, startUpgradeFor,
  playerProfile, getScouting, hireScoutFor, fireScoutFor, createScoutTaskFor, previewScoutTaskFor, removeScoutTaskFor, scoutTaskPlayersFor, scoutedPlayersFor, shortlistFor, getYouth, promoteYouthFor, releaseYouthFor,
} from '../services/saveService.node.ts';
import { ValidationError } from '../services/careerService.ts';
import { UserError } from '../shared/errors.ts';
import { ImageError, inspectImage, MAX_PHOTO_BYTES } from '../shared/photo.ts';
import type { EditorListQuery, IpcResult, MarketFilter, OfferInput, PackImportDto, PhotoPick, RenewInput, SchemeInput } from '../shared/api.ts';
import { setBaseUniverseDir } from '../services/universeService.node.ts';
import { careerUniverse, exportPackZip, imageIndex, importPackZip, listPacks, packsDir, removePack, setLoadOrder, setUniverseCacheTag, warmUniverse } from '../services/packManager.node.ts';
import { imagesVersion, listPackImages, packImageFile, removePackImage, setPackImage, type ImageKind } from '../services/imageService.node.ts';
import { editorCreatePack, editorGet, editorList, editorOptions, editorRemove, editorRevert, editorSave, editorSummary, editorUpdateManifest, editorImportCsv, editorExportCsvRows } from '../services/editorService.node.ts';
import { decodeCsv } from '../game/data-pack/csv.ts';

// O nome do produto (FOOTERA) não muda a pasta dos saves: o app instalado usa a mesma pasta de sempre,
// senão carreiras criadas antes da troca de nome sumiriam da lista.
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'football-manager-simulator'));
const dataDir = () => path.join(app.getPath('userData'), 'data');
// base de dados fixa distribuída com o jogo (no app instalado fica dentro do app.asar; o fs do Electron lê de lá)
setBaseUniverseDir(path.join(app.getAppPath(), 'data', 'base'));
// cache do universo em disco vale só para esta versão do programa (a data do executável muda a cada build em desenvolvimento)
setUniverseCacheTag(`${app.getVersion()}:${(() => { try { return fs.statSync(__filename).mtimeMs; } catch { return 0; } })()}`);
const uuid = z.string().uuid();

/** Fotos escolhidas aguardando a criação da carreira. O renderer só conhece o token, nunca o caminho. */
const pendingPhotos = new Map<string, Uint8Array>();
const MAX_PENDING = 8;
/** Medição de desempenho: loga as chamadas IPC de 50 ms ou mais (em desenvolvimento ou com FOOTERA_PERF=1). */
const PERF_LOG = process.env.FOOTERA_PERF === '1' || !app.isPackaged;
const T0 = performance.now();
/** marcos da abertura do app (mesmo critério do log de IPC) */
const mark = (what: string) => { if (PERF_LOG) console.log(`[perf] abertura: ${what} em ${Math.round(performance.now() - T0)} ms`); };

function handle<I, T>(channel: string, schema: z.ZodType<I, z.ZodTypeDef, unknown>, fn: (input: I) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Dados inválidos: ' + parsed.error.issues.map((i) => i.message).join('; ') };
    const t0 = performance.now();
    try { return { ok: true, data: await fn(parsed.data) }; }
    catch (err) {
      if (err instanceof ValidationError || err instanceof ImageError || err instanceof UserError) return { ok: false, error: err.message };
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: `Erro inesperado: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      const ms = performance.now() - t0;
      if (PERF_LOG && ms >= 50) console.log(`[perf] ${channel} ${Math.round(ms)} ms`);
    }
  });
}

function registerHandlers(): void {
  handle('app:info', z.unknown(), () => ({ dataDir: dataDir(), version: app.getVersion() }));
  handle('profile:list', z.unknown(), () => listProfiles(dataDir()));
  handle('profile:create', z.object({ name: z.string().max(200) }), (i) => createProfile(dataDir(), i.name));
  handle('world:clubs', z.unknown(), () => { const u = careerUniverse(dataDir()); return listClubs(u.world, u.origin); });

  // ---- pacotes de dados do usuário (etapa 2 da base editável)
  let lastZip: Buffer | null = null; // último .zip escolhido (para "substituir" sem abrir o diálogo de novo)
  const packId = z.string().min(1).max(80);
  handle('packs:list', z.unknown(), () => listPacks(dataDir()));
  const imageKeys = () => ({ version: imagesVersion(), keys: [...imageIndex(dataDir()).keys()] });
  handle('images:keys', z.unknown(), () => imageKeys());
  handle('images:version', z.unknown(), () => { imageIndex(dataDir()); return imagesVersion(); });
  const imgRef = z.object({ packId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/), kind: z.enum(['players', 'clubs', 'stadiums', 'leagues', 'coaches', 'cups']), id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/) });
  const packDirFor = (id: string) => { const d = path.join(packsDir(dataDir()), id); if (!fs.existsSync(path.join(d, 'manifest.json'))) throw new ValidationError('Pacote não encontrado.'); return d; };
  const packImageKeys = (id: string) => ({ version: imagesVersion(), keys: listPackImages(packDirFor(id)).map((im) => `${im.kind}/${im.id}`) });
  handle('editor:imageKeys', z.object({ packId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/) }), (i) => packImageKeys(i.packId));
  handle('editor:setImage', imgRef, async (i) => {
    const opts: OpenDialogOptions = { title: 'Escolher imagem (PNG ou JPEG)', properties: ['openFile'], filters: [{ name: 'Imagens PNG ou JPEG', extensions: ['png', 'jpg', 'jpeg'] }] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    if (fs.statSync(file).size > MAX_PHOTO_BYTES) throw new ValidationError(`A imagem excede o limite de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    setPackImage(packDirFor(i.packId), i.kind as ImageKind, i.id, new Uint8Array(fs.readFileSync(file)));
    return packImageKeys(i.packId);
  });
  const csvRef = z.object({ packId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/), kind: z.enum(['players', 'clubs']) });
  handle('editor:importCsv', csvRef, async (i) => {
    const opts: OpenDialogOptions = { title: 'Importar planilha (CSV)', properties: ['openFile'], filters: [{ name: 'Planilha CSV', extensions: ['csv', 'txt'] }] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new ValidationError('A planilha excede o limite de 20 MB.');
    const buf = fs.readFileSync(file);
    // o Excel em português salva CSV em Windows-1252 por padrão; UTF-8 (com ou sem BOM) também é aceito
    return editorImportCsv(dataDir(), i.packId, i.kind, decodeCsv(new Uint8Array(buf)));
  });
  const idRef = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
  const csvFilter = z.object({ countryId: idRef.optional(), leagueId: idRef.optional(), clubId: idRef.optional(),
    position: z.enum(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF']).optional() }).strict();
  handle('editor:exportCsv', csvRef.extend({ template: z.boolean(), filter: csvFilter.optional() }), async (i) => {
    const f = i.filter ?? {};
    const suffix = i.template ? '-modelo' : [f.countryId, f.leagueId, f.clubId, f.position?.toLowerCase()].filter(Boolean).map((x) => `-${x}`).join('');
    const opts: SaveDialogOptions = { title: i.template ? 'Salvar modelo de planilha' : 'Exportar planilha', defaultPath: `${i.kind === 'players' ? 'jogadores' : 'clubes'}${suffix}.csv`, filters: [{ name: 'Planilha CSV', extensions: ['csv'] }] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    const out = editorExportCsvRows(dataDir(), i.packId, i.kind, i.template, f);
    fs.writeFileSync(res.filePath, out.text, 'utf8');
    return { path: res.filePath, rows: out.rows };
  });
  handle('editor:removeImage', imgRef, (i) => { removePackImage(packDirFor(i.packId), i.kind as ImageKind, i.id); return packImageKeys(i.packId); });
  handle('packs:order', z.object({ enabled: z.array(packId).max(100) }), (i) => setLoadOrder(dataDir(), i.enabled));
  handle('packs:remove', z.object({ id: packId }), (i) => removePack(dataDir(), i.id));
  handle('packs:folder', z.unknown(), async () => { fs.mkdirSync(packsDir(dataDir()), { recursive: true }); await shell.openPath(packsDir(dataDir())); return true as const; });
  // ---- editor de dados (os registros são validados pelo formato dos pacotes e pela montagem do universo antes de gravar)
  const kind = z.enum(['countries', 'leagues', 'clubs', 'players', 'coaches', 'cups']);
  const pk = { packId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/) };
  const rec = z.record(z.unknown()).refine((r) => JSON.stringify(r).length < 200_000, 'registro grande demais');
  handle('editor:create', z.object({ name: z.string().trim().min(1).max(80), author: z.string().max(80).optional(), description: z.string().max(1000).optional() }), (i) => editorCreatePack(dataDir(), i));
  handle('editor:summary', z.object(pk), (i) => editorSummary(dataDir(), i.packId));
  handle('editor:manifest', z.object({ ...pk, name: z.string().trim().min(1).max(80), version: z.string().trim().min(1).max(20), author: z.string().max(80).optional(), description: z.string().max(1000).optional() }), (i) => editorUpdateManifest(dataDir(), i.packId, i));
  handle('editor:options', z.object(pk), (i) => editorOptions(dataDir(), i.packId));
  handle('editor:list', z.object({ ...pk, query: z.object({
    kind, search: z.string().max(60).optional(), countryId: z.string().max(60).optional(), leagueId: z.string().max(60).optional(), clubId: z.string().max(60).optional(),
    position: z.enum(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST']).optional(),
    onlyChanged: z.boolean().optional(), offset: z.number().int().min(0).max(1e6).optional(), limit: z.number().int().min(1).max(300).optional(),
  }) }), (i) => editorList(dataDir(), i.packId, i.query as EditorListQuery));
  handle('editor:get', z.object({ ...pk, kind, id: z.string().min(1).max(60) }), (i) => editorGet(dataDir(), i.packId, i.kind, i.id));
  handle('editor:save', z.object({ ...pk, kind, record: rec, stadium: rec.nullable() }), (i) => editorSave(dataDir(), i.packId, i.kind, i.record, i.stadium));
  handle('editor:remove', z.object({ ...pk, kind, id: z.string().min(1).max(60) }), (i) => editorRemove(dataDir(), i.packId, i.kind, i.id));
  handle('editor:revert', z.object({ ...pk, kind, id: z.string().min(1).max(60) }), (i) => editorRevert(dataDir(), i.packId, i.kind, i.id));
  handle('editor:export', z.object(pk), async (i) => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = { title: 'Exportar pacote de dados', defaultPath: `${i.packId}.zip`, filters: [{ name: 'Pacote de dados', extensions: ['zip'] }] };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { saved: false };
    fs.writeFileSync(res.filePath, exportPackZip(dataDir(), i.packId));
    return { saved: true, path: res.filePath };
  });
  handle('packs:import', z.object({ overwrite: z.boolean() }), async (i): Promise<PackImportDto> => {
    if (!i.overwrite || !lastZip) {
      const opts: OpenDialogOptions = { title: 'Importar pacote de dados (.zip)', properties: ['openFile'], filters: [{ name: 'Pacote de dados', extensions: ['zip'] }] };
      const win = BrowserWindow.getFocusedWindow();
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      const file = res.filePaths[0];
      if (res.canceled || !file) return { status: 'cancelled' };
      if (fs.statSync(file).size > 256 * 1024 * 1024) throw new ValidationError('O arquivo é grande demais (limite de 256 MB).');
      lastZip = fs.readFileSync(file);
    }
    const r = importPackZip(dataDir(), lastZip, i.overwrite);
    if (r.status === 'imported') lastZip = null;
    return r;
  });

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
  handle('career:delete', ref, (i) => deleteCareerSave(dataDir(), i.profileId, i.careerId, async (dir) => {
    try { await shell.trashItem(dir); } catch (e) { throw new ValidationError(`Não foi possível mover o save para a Lixeira: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  handle('career:reveal', ref, (i) => { shell.showItemInFolder(careerSaveFile(dataDir(), i.profileId, i.careerId)); return true as const; });
  handle('career:calendar', ref, (i) => getCalendar(dataDir(), i.profileId, i.careerId));
  handle('career:competitions', ref, (i) => listCompetitionsFor(dataDir(), i.profileId, i.careerId));
  handle('career:table', ref.extend({ competitionId: z.string().min(1).max(100) }), (i) => getTable(dataDir(), i.profileId, i.careerId, i.competitionId));
  handle('career:advance', ref.extend({ mode: z.enum(['day', 'nextMatchday']) }), (i) => advanceCareer(dataDir(), i.profileId, i.careerId, i.mode));
  handle('career:continue', ref, (i) => continueCareerDay(dataDir(), i.profileId, i.careerId));
  handle('career:leaders', ref.extend({ competitionId: z.string().min(1).max(100) }), (i) => getLeaders(dataDir(), i.profileId, i.careerId, i.competitionId));
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
  handle('transfers:counter', ref.extend({ offerId: z.number().int().positive(), fee: z.number().int().min(1).max(1e10) }), (i) => answerWithCounterOffer(dataDir(), i.profileId, i.careerId, i.offerId, i.fee));
  handle('transfers:list', ref.extend({ playerId: z.string().min(1).max(60), listed: z.boolean() }), (i) => listPlayerForSale(dataDir(), i.profileId, i.careerId, i.playerId, i.listed));
  handle('finance:get', ref, (i) => getFinance(dataDir(), i.profileId, i.careerId));
  handle('finance:ledger', ref.extend({ query: z.object({ page: z.number().int().min(0).max(100000), category: z.string().min(1).max(30).optional() }) }), (i) => financeLedger(dataDir(), i.profileId, i.careerId, i.query));
  const sponsorKind = z.enum(['shirt', 'kit', 'stadium']);
  handle('sponsor:negotiate', ref.extend({ input: z.object({ offerId: z.string().min(1).max(120), monthly: z.number().int().min(1).max(1e9), years: z.number().int().min(1).max(4) }) }),
    (i) => sponsorNegotiate(dataDir(), i.profileId, i.careerId, i.input));
  handle('sponsor:accept', ref.extend({ offerId: z.string().min(1).max(120), years: z.number().int().min(1).max(4) }), (i) => sponsorAccept(dataDir(), i.profileId, i.careerId, i.offerId, i.years));
  handle('sponsor:terminate', ref.extend({ kind: sponsorKind }), (i) => sponsorTerminate(dataDir(), i.profileId, i.careerId, i.kind));
  handle('sponsor:search', ref.extend({ kind: sponsorKind }), (i) => sponsorSearch(dataDir(), i.profileId, i.careerId, i.kind));
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
    playerId: z.string().min(1).max(60), wage: z.number().int().min(1).max(1e9), years: z.number().int().min(0).max(5),
    status: z.enum(['key', 'starter', 'rotation', 'backup', 'prospect']).optional(),
  }) }), (i) => offerRenewal(dataDir(), i.profileId, i.careerId, i.input as RenewInput));
  handle('contracts:terminate', ref.extend({ playerId: z.string().min(1).max(60) }), (i) => rescindContract(dataDir(), i.profileId, i.careerId, i.playerId));
  handle('news:list', ref, (i) => listNews(dataDir(), i.profileId, i.careerId));
  handle('news:read', ref.extend({ id: z.number().int().positive().nullable() }), (i) => markInboxRead(dataDir(), i.profileId, i.careerId, i.id));
  handle('news:social', ref.extend({ filter: z.enum(['all', 'mine', 'match', 'transfer', 'injury', 'coach', 'league']) }), (i) => socialFeed(dataDir(), i.profileId, i.careerId, i.filter));
  handle('career:history', ref, (i) => careerHistory(dataDir(), i.profileId, i.careerId));
  handle('career:trophies', ref.extend({ clubId: z.string().min(1).max(80).optional() }), (i) => trophyRoom(dataDir(), i.profileId, i.careerId, i.clubId));
  const id60 = z.string().min(1).max(60);
  handle('scouting:get', ref, (i) => getScouting(dataDir(), i.profileId, i.careerId));
  handle('scouting:hire', ref.extend({ candidateId: id60 }), (i) => hireScoutFor(dataDir(), i.profileId, i.careerId, i.candidateId));
  handle('scouting:fire', ref.extend({ scoutId: id60 }), (i) => fireScoutFor(dataDir(), i.profileId, i.careerId, i.scoutId));
  const posEnum = z.enum(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST']);
  const numRange = z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).strict().optional();
  const scoutTask = z.object({
    scope: z.enum(['country', 'league', 'world']), area: z.string().max(60), name: z.string().max(80).optional(), months: z.number().int().min(1).max(24).nullable(),
    criteria: z.object({
      positions: z.array(posEnum).max(16).optional(), secondary: z.array(posEnum).max(16).optional(),
      overall: numRange, potential: numRange, age: numRange, value: numRange, salary: numRange, reputation: numRange, condition: numRange, morale: numRange,
      foot: z.enum(['left', 'right', 'both']).optional(), status: z.enum(['free', 'expiring', 'contracted']).optional(),
      attributes: z.record(z.string().max(30), z.number().finite()).optional(),
      stats: z.object({ appearances: z.number().finite().optional(), minutes: z.number().finite().optional(), goals: z.number().finite().optional(),
        assists: z.number().finite().optional(), avgRating: z.number().finite().optional() }).strict().optional(),
    }).strict(),
  });
  handle('scouting:task-create', ref.extend({ input: scoutTask }), (i) => createScoutTaskFor(dataDir(), i.profileId, i.careerId, i.input));
  handle('scouting:task-preview', ref.extend({ input: scoutTask }), (i) => previewScoutTaskFor(dataDir(), i.profileId, i.careerId, i.input));
  handle('scouting:task-remove', ref.extend({ taskId: id60 }), (i) => removeScoutTaskFor(dataDir(), i.profileId, i.careerId, i.taskId));
  handle('scouting:task-players', ref.extend({ taskId: id60 }), (i) => scoutTaskPlayersFor(dataDir(), i.profileId, i.careerId, i.taskId));
  handle('scouting:players', ref.extend({ playerIds: z.array(id60).max(60) }), (i) => scoutedPlayersFor(dataDir(), i.profileId, i.careerId, i.playerIds));
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
  handle('training:weekSession', ref.extend({ dow: z.number().int().min(0).max(6), session: z.enum(['physical', 'technical', 'tactical', 'prematch', 'recovery', 'rest']) }),
    (i) => setTrainingWeekSession(dataDir(), i.profileId, i.careerId, i.dow, i.session));
  handle('training:template', ref.extend({ template: z.enum(['balanced', 'preseason', 'tactical', 'double', 'recovery']) }), (i) => applyTrainingTemplate(dataDir(), i.profileId, i.careerId, i.template));
  handle('training:autoAdjust', ref.extend({ on: z.boolean() }), (i) => setTrainingAutoAdjust(dataDir(), i.profileId, i.careerId, i.on));
  handle('training:gkSession', ref.extend({ playerId: id60, session: z.enum(['reflexes', 'aerial', 'distribution']).nullable() }),
    (i) => setTrainingGkSession(dataDir(), i.profileId, i.careerId, i.playerId, i.session));
  handle('staff:get', ref, (i) => getStaff(dataDir(), i.profileId, i.careerId));
  handle('staff:hire', ref.extend({ candidateId: id60 }), (i) => hireStaffFor(dataDir(), i.profileId, i.careerId, i.candidateId));
  handle('staff:fire', ref.extend({ staffId: id60 }), (i) => fireStaffFor(dataDir(), i.profileId, i.careerId, i.staffId));
  handle('medical:get', ref, (i) => getMedical(dataDir(), i.profileId, i.careerId));
  handle('infra:get', ref, (i) => getInfrastructure(dataDir(), i.profileId, i.careerId));
  handle('infra:upgrade', ref.extend({ kind: z.enum(['training', 'youth', 'medical', 'stadium', 'scouting', 'recruitment']) }), (i) => startUpgradeFor(dataDir(), i.profileId, i.careerId, i.kind));
  handle('board:get', ref, (i) => getBoard(dataDir(), i.profileId, i.careerId));
  handle('cup:bracket', ref.extend({ competitionId: z.string().min(1).max(120) }), (i) => cupBracket(dataDir(), i.profileId, i.careerId, i.competitionId));
  handle('staged:view', ref.extend({ competitionId: z.string().min(1).max(120) }), (i) => stagedView(dataDir(), i.profileId, i.careerId, i.competitionId));
  handle('club:info', ref.extend({ clubId: z.string().min(1).max(80) }), (i) => clubInfo(dataDir(), i.profileId, i.careerId, i.clubId));
  handle('club:profile', ref.extend({ clubId: z.string().min(1).max(80) }), (i) => clubProfile(dataDir(), i.profileId, i.careerId, i.clubId));
  handle('talk:list', ref, (i) => conversations(dataDir(), i.profileId, i.careerId));
  handle('talk:player', ref.extend({ playerId: z.string().min(1).max(80), topic: z.enum(['praise', 'demand', 'promise_minutes', 'promise_renewal']) }), (i) => playerTalk(dataDir(), i.profileId, i.careerId, i.playerId, i.topic));
  handle('talk:board', ref.extend({ topic: z.enum(['promise_position', 'promise_wins']) }), (i) => boardTalk(dataDir(), i.profileId, i.careerId, i.topic));
  handle('coach:info', ref.extend({ coachId: z.string().min(1).max(80) }), (i) => aiCoachInfo(dataDir(), i.profileId, i.careerId, i.coachId));
  handle('coach:unemployed', ref, (i) => unemployedCoaches(dataDir(), i.profileId, i.careerId));
  handle('board:job', ref.extend({ offerId: z.number().int().positive(), accept: z.boolean() }), (i) => answerJobOffer(dataDir(), i.profileId, i.careerId, i.offerId, i.accept));
  handle('coach:career', ref, (i) => coachCareer(dataDir(), i.profileId, i.careerId));
  handle('coach:enroll', ref.extend({ license: z.enum(['C', 'B', 'A', 'PRO']) }), (i) => enrollLicenseFor(dataDir(), i.profileId, i.careerId, i.license));
  handle('board:coachPoint', ref.extend({ key: z.enum(['tactics', 'motivation', 'youth', 'discipline', 'negotiation', 'adaptability']) }), (i) => spendCoachPointFor(dataDir(), i.profileId, i.careerId, i.key));
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
  // depois da 1ª pintura: o universo da carreira nova vem do cache em disco (se houver), para "Nova carreira" abrir sem espera
  win.webContents.once('dom-ready', () => mark('DOM pronto'));
  win.webContents.once('did-finish-load', () => {
    mark('página carregada');
    setTimeout(() => { const t = performance.now(); try { warmUniverse(dataDir()); } catch { /* monta quando pedirem */ } mark(`universe em cache (${Math.round(performance.now() - t)} ms)`); }, 400);
  });
}

// imagens dos pacotes: footera-img://img/<tipo>/<id> (só o que está no índice dos pacotes ativos ou do pacote em edição)
const IMG_KINDS = new Set(['players', 'clubs', 'stadiums', 'leagues', 'coaches', 'cups']);
// a URL leva a versão do índice (?v=): a imagem pode ficar em cache sem revalidar (versão nova = URL nova)
protocol.registerSchemesAsPrivileged([{ scheme: 'footera-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  mark('Electron pronto');
  protocol.handle('footera-img', (req) => {
    const u = new URL(req.url);
    const [, kind, id] = u.pathname.split('/');
    const pack = u.searchParams.get('pack');
    let file: string | null | undefined;
    if (pack && /^[a-z0-9][a-z0-9_-]{0,59}$/.test(pack)) file = IMG_KINDS.has(kind ?? '') && /^[a-z0-9][a-z0-9_-]{0,59}$/.test(id ?? '') ? packImageFile(path.join(packsDir(dataDir()), pack), kind as ImageKind, id!) : null;
    else file = imageIndex(dataDir()).get(`${kind}/${id}`);
    if (!file) return new Response(null, { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' } });
  });
  registerHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// fecha os saves abertos (grava o -wal no arquivo principal)
app.on('before-quit', () => closeAllCareerDbs());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
