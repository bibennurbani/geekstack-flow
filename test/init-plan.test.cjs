'use strict';

// Card 5 [3] — the pure init plan lifted out of main(): computeInitPlan / initVars / renderConfigYaml.
// These ran only inside main()'s prompt+fs flow before, so the single-vs-multi decision and the
// config.yaml render were untestable without driving stdin and writing disk. Now they're pure.
// renderConfigYaml is exercised against the REAL workspace template so this doubles as a
// characterization test of init's config output.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gsf = require('../init.js');

const TEMPLATE_CONFIG = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'workspace', '.tcgstackflow', 'config.yaml'), 'utf8'
);

const baseAnswers = {
  projectName: 'demo-app', stack: 'Next.js 16 + Prisma', packageManager: 'npm',
  enableTempo: false, cloudId: '', adminKey: '', timezone: '+0800', submissionMode: 'approval',
  enableClaude: true, enableCodex: false, enableGithub: false,
};

test('initVars(): maps answers to template placeholders, with defaults for the optionals', () => {
  const v = gsf.initVars({ projectName: 'x' });
  assert.strictEqual(v['project-name'], 'x');
  assert.strictEqual(v['package-manager'], 'pnpm', 'default pnpm');
  assert.strictEqual(v['timezone'], '+0800', 'default tz');
  assert.strictEqual(v['submission-mode'], 'approval', 'default mode');
  assert.strictEqual(v['stack'], '');
});

test('computeInitPlan(): 0 detected → single', () => {
  const plan = gsf.computeInitPlan(baseAnswers, []);
  assert.strictEqual(plan.workspace_kind, 'single');
  assert.strictEqual(plan.project_count, 0);
  assert.strictEqual(plan.vars['project-name'], 'demo-app');
});

test('computeInitPlan(): 1 detected → still single (one sub-project is not multi)', () => {
  const plan = gsf.computeInitPlan(baseAnswers, [{ name: 'api', path: 'api', stack: '.NET' }]);
  assert.strictEqual(plan.workspace_kind, 'single');
  assert.strictEqual(plan.project_count, 1);
});

test('computeInitPlan(): 2+ detected → multi-project, projects passed through', () => {
  const detected = [
    { name: 'api', path: 'Api', stack: '.NET', package_manager: 'dotnet' },
    { name: 'spa', path: 'Spa', stack: 'Vue 3', package_manager: 'pnpm' },
  ];
  const plan = gsf.computeInitPlan(baseAnswers, detected);
  assert.strictEqual(plan.workspace_kind, 'multi-project');
  assert.strictEqual(plan.project_count, 2);
  assert.deepStrictEqual(plan.projects, detected);
});

test('renderConfigYaml(): substitutes the scalar fields + tool booleans against the real template', () => {
  const out = gsf.renderConfigYaml(TEMPLATE_CONFIG, baseAnswers, [], '0.3.0');
  assert.match(out, /tcgflow_version: "0\.3\.0"/);
  assert.match(out, /name: "demo-app"/);
  assert.match(out, /primary_stack: "Next\.js 16 \+ Prisma"/);
  assert.match(out, /package_manager: npm/);
  assert.match(out, /claude: true/);
  assert.match(out, /codex: false/);
  assert.match(out, /github: false/);
  assert.match(out, /enabled: false/, 'tempo stays disabled');
  // single workspace: layout untouched
  assert.match(out, /workspace_kind: single/);
  assert.match(out, /projects: \[\]/);
  // template placeholders are gone
  assert.doesNotMatch(out, /tcgflow_version: "0\.0\.0"/);
});

test('renderConfigYaml(): tool/tempo answers flip the booleans', () => {
  const out = gsf.renderConfigYaml(TEMPLATE_CONFIG, { ...baseAnswers, enableTempo: true, enableCodex: true, enableGithub: true }, [], '0.3.0');
  assert.match(out, /enabled: true/);
  assert.match(out, /codex: true/);
  assert.match(out, /github: true/);
});

test('renderConfigYaml(): 2+ projects rewrites workspace_kind and fills the projects list', () => {
  const detected = [
    { name: 'api', path: 'Api', stack: '.NET 10', package_manager: 'dotnet', test: 'dotnet test' },
    { name: 'spa', path: 'Spa', stack: 'Vue 3', package_manager: 'pnpm', test: 'pnpm test:unit' },
  ];
  const out = gsf.renderConfigYaml(TEMPLATE_CONFIG, baseAnswers, detected, '0.3.0');
  assert.match(out, /workspace_kind: multi-project/);
  assert.doesNotMatch(out, /projects: \[\]/, 'the empty list placeholder is replaced');
  assert.match(out, /^\s+- name: api$/m);
  assert.match(out, /^\s+path: Api$/m);
  assert.match(out, /^\s+test: "dotnet test"$/m);
  assert.match(out, /^\s+- name: spa$/m);
});
