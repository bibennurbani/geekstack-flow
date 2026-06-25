'use strict';

// Card 5 — characterization tests for init.js's project-detection brain. analyseProject() is the most
// branch-dense pure logic in the installer (a 9-ecosystem priority cascade) and was exported "so they can
// be unit-tested without running the full installer" — but had ZERO tests, while its simpler MIGRATIONS
// sibling had a suite. These pin the documented contract (ADR 0015) so a reorder of the cascade or a new
// ecosystem can't silently change classification. No code change — the seam already existed; this makes it live.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gsf = require('../init.js');

const pkg = (deps = {}, scripts = {}, dev = {}) => JSON.stringify({ dependencies: deps, devDependencies: dev, scripts });
function mkProj(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-det-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}
const rm = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('analyseProject: JS/TS stack + package-manager + scripts (Ionic/Vue via pnpm)', () => {
  const d = mkProj({ 'package.json': pkg({ '@ionic/vue': '^8' }, { test: 'vitest', lint: 'eslint' }), 'pnpm-lock.yaml': '' });
  try {
    const r = gsf.analyseProject(d, 'mobile');
    assert.strictEqual(r.stack, 'Ionic + Vue 3 + Capacitor');
    assert.strictEqual(r.package_manager, 'pnpm');
    assert.strictEqual(r.test, 'pnpm test');
    assert.strictEqual(r.lint, 'pnpm lint');
    assert.strictEqual(r.name, 'mobile');
  } finally { rm(d); }
});

test('analyseProject: Pulumi overrides JS when @pulumi/pulumi is a dep', () => {
  const d = mkProj({ 'Pulumi.yaml': 'name: infra\n', 'package.json': pkg({ '@pulumi/pulumi': '^3' }), 'pnpm-lock.yaml': '' });
  try {
    const r = gsf.analyseProject(d, 'infra');
    assert.strictEqual(r.stack, 'Pulumi IaC (TypeScript)');
    assert.strictEqual(r.package_manager, 'pnpm');
  } finally { rm(d); }
});

test('analyseProject: package.json wins over a .sln (VS scaffolding for a frontend)', () => {
  const d = mkProj({ 'package.json': pkg({ vue: '^3' }), 'App.sln': '', 'package-lock.json': '' });
  try {
    const r = gsf.analyseProject(d, 'web');
    assert.strictEqual(r.stack, 'Vue 3 + TypeScript');
    assert.strictEqual(r.package_manager, 'npm', 'package-lock.json → npm');
  } finally { rm(d); }
});

test('analyseProject: .NET detected via the src/<project>/*.csproj layout', () => {
  const d = mkProj({ 'src/Api/Api.csproj': '<Project/>\n' });
  try {
    const r = gsf.analyseProject(d, 'backend');
    assert.strictEqual(r.stack, '.NET');
    assert.strictEqual(r.package_manager, 'dotnet');
    assert.strictEqual(r.test, 'dotnet test');
  } finally { rm(d); }
});

test('analyseProject: Go, Python(poetry), and the null fallback', () => {
  const go = mkProj({ 'go.mod': 'module x\n' });
  const py = mkProj({ 'pyproject.toml': '[tool.poetry]\n', 'poetry.lock': '' });
  const none = mkProj({ 'README.md': '# just docs' });
  try {
    assert.strictEqual(gsf.analyseProject(go, 'svc').stack, 'Go');
    const p = gsf.analyseProject(py, 'ml');
    assert.strictEqual(p.stack, 'Python');
    assert.strictEqual(p.package_manager, 'poetry');
    assert.strictEqual(p.test, 'poetry run pytest');
    assert.strictEqual(gsf.analyseProject(none, 'docs'), null, 'unrecognised dir → null');
  } finally { rm(go, py, none); }
});

test('detectProjects: finds multiple sub-projects, skips dotfiles + SKIP_DIRS; renderProjectsYaml shapes them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-multi-'));
  const sub = (name, body) => { fs.mkdirSync(path.join(root, name), { recursive: true }); fs.writeFileSync(path.join(root, name, 'package.json'), body); };
  sub('api', pkg({ '@nestjs/core': '^10' }));
  sub('web', pkg({ vue: '^3' }));
  sub('node_modules', pkg());                 // SKIP_DIRS → ignored
  fs.mkdirSync(path.join(root, '.git'));       // dotfile dir → ignored
  try {
    const projects = gsf.detectProjects(root);
    assert.deepStrictEqual(projects.map((p) => p.name).sort(), ['api', 'web'], 'two real sub-projects; node_modules + .git skipped');
    assert.strictEqual(projects.find((p) => p.name === 'api').stack, 'NestJS');
    const yaml = gsf.renderProjectsYaml(projects);
    assert.match(yaml, /- name: api/);
    assert.match(yaml, /stack: "NestJS"/);
  } finally { rm(root); }
});
