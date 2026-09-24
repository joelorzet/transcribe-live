import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '@shared/language/language-detector';
import { splitIntoCaptions } from '@modules/transcription/domain/caption-splitter';

const CANDIDATES = ['es', 'en', 'pt'] as const;

test('detects Spanish conference speech', () => {
  const text = 'Buenos días a todos y bienvenidos a Nerdearla. Hoy vamos a hablar de observabilidad en Kubernetes.';
  assert.equal(detectLanguage(text, CANDIDATES), 'es');
});

test('detects English conference speech', () => {
  const text = 'Welcome everyone to this session about platform engineering and the tools that we use.';
  assert.equal(detectLanguage(text, CANDIDATES), 'en');
});

test('detects Portuguese conference speech', () => {
  const text = 'Olá a todos, hoje nós vamos falar sobre observabilidade e não é uma coisa muito simples.';
  assert.equal(detectLanguage(text, CANDIDATES), 'pt');
});

test('returns undefined when there is nothing to go on', () => {
  assert.equal(detectLanguage('', CANDIDATES), undefined);
  assert.equal(detectLanguage('Kubernetes gRPC OpenTelemetry', CANDIDATES), undefined);
});

test('splits a long final into readable caption lines', () => {
  const text =
    'Buenos días a todos y bienvenidos a Nerdearla. Hoy vamos a hablar de observabilidad en Kubernetes a escala. ' +
    'Migramos de Prometheus a OpenTelemetry usando gRPC para el transporte.';
  const lines = splitIntoCaptions(text);

  assert.ok(lines.length >= 3, 'expected several caption lines');
  for (const line of lines) {
    assert.ok(line.length <= 90, `line too long for a subtitle: ${line}`);
  }
  assert.ok(lines.join(' ').includes('Nerdearla'));
});

test('leaves a short caption untouched', () => {
  assert.deepEqual(splitIntoCaptions('Gracias a todos.'), ['Gracias a todos.']);
});
