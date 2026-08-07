import { describe, expect, it } from 'vitest';
import { resolveDataRoot, resolveDataPaths, APP_DIR_NAME } from '../../src/config/paths.js';

describe('resolveDataRoot', () => {
  it('prioriza o override explícito', () => {
    const root = resolveDataRoot({ AUTOMATION_SEGUIDORES_HOME: 'D:\\dados\\ig' });
    expect(root).toContain('ig');
  });

  it('usa LOCALAPPDATA no Windows', () => {
    const root = resolveDataRoot({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' });
    expect(root).toContain(APP_DIR_NAME);
    expect(root).toContain('AppData');
  });

  it('não aponta para dentro de uma pasta do OneDrive', () => {
    const root = resolveDataRoot({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' });
    expect(root.toLowerCase()).not.toContain('onedrive');
  });

  it('cai para o diretório home quando não há variáveis', () => {
    const root = resolveDataRoot({});
    expect(root).toContain(APP_DIR_NAME);
  });
});

describe('resolveDataPaths', () => {
  it('deriva banco, perfil e evidências sob a raiz', () => {
    const paths = resolveDataPaths({ AUTOMATION_SEGUIDORES_HOME: '/tmp/ig' });
    expect(paths.database).toContain(paths.root);
    expect(paths.browserProfile).toContain(paths.root);
    expect(paths.screenshots).toContain(paths.evidence);
    expect(paths.traces).toContain(paths.evidence);
  });
});
