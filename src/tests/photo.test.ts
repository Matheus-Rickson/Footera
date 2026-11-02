import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage, ImageError, MAX_PHOTO_BYTES } from '../shared/photo.ts';
import { makePng, makeJpeg } from './fixtures.ts';

test('Foto: PNG válido é aceito com dimensões corretas', () => {
  const info = inspectImage(makePng(128, 96));
  assert.deepEqual([info.format, info.width, info.height], ['png', 128, 96]);
});

test('Foto: PNG corrompido (CRC), truncado ou com lixo no final é rejeitado', () => {
  const png = makePng(80, 80);
  const bad = png.slice(); bad[20] ^= 0xff;
  assert.throws(() => inspectImage(bad), /corrompido|inválido/);
  assert.throws(() => inspectImage(png.slice(0, png.length - 5)), ImageError);
  const extra = new Uint8Array(png.length + 3); extra.set(png);
  assert.throws(() => inspectImage(extra), /extras/);
});

test('Foto: JPEG estruturalmente válido é aceito; truncado é rejeitado', () => {
  const info = inspectImage(makeJpeg(200, 150));
  assert.deepEqual([info.format, info.width, info.height], ['jpeg', 200, 150]);
  assert.throws(() => inspectImage(makeJpeg(200, 150, false)), /truncado/);
  assert.throws(() => inspectImage(makeJpeg(200, 150).slice(0, 30)), ImageError);
});

test('Foto: formato, tamanho e dimensões inválidos são rejeitados', () => {
  assert.throws(() => inspectImage(new Uint8Array(0)), /vazio/);
  assert.throws(() => inspectImage(new TextEncoder().encode('GIF89a-isto-nao-e-png-nem-jpeg')), /Formato não suportado/);
  assert.throws(() => inspectImage(makePng(32, 32)), /pequena/);
  assert.throws(() => inspectImage(makePng(5000, 100)), /grande/);
  assert.throws(() => inspectImage(new Uint8Array(MAX_PHOTO_BYTES + 1)), /limite/);
  // arquivo .png "renomeado" de outro conteúdo é rejeitado pelo conteúdo, não pela extensão
  assert.throws(() => inspectImage(new TextEncoder().encode('MZ executavel.exe')), ImageError);
});
