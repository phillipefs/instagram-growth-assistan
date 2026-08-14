import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { performFollow } from '../../src/browser/follow-action.js';
import { readProfileSignals } from '../../src/browser/read-profile.js';
import { assessProfile } from '../../src/browser/profile-detector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/follow');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

const readOptions = { allowedHosts: [''] };

test('um clique de seguir confirma FOLLOWING', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('NOT_FOLLOWING');
  const after = await performFollow(page, readOptions);
  expect(after).toEqual({ clicked: true, relationship: 'FOLLOWING' });
});

test('conta privada resulta em solicitação enviada', async ({ page }) => {
  await page.goto(fixtureUrl('follow_request.html'));
  const after = await performFollow(page, readOptions);
  expect(after).toEqual({ clicked: true, relationship: 'FOLLOW_REQUESTED' });
});

test('não usa botão Seguir de sugestão quando o perfil não tem botão principal', async ({
  page,
}) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_sem_botao</h2>
        <div>10 posts 100 seguidores 50 seguindo</div>
      </section>
      <section>
        <h3>Sugestões para você</h3>
        <article>
          <a href="/conta_sugerida/">conta_sugerida</a>
          <button id="suggested" onclick="this.dataset.clicked='true'">Seguir</button>
        </article>
      </section>
    </header>
    <main><a href="/p/AAA/">Post</a></main>
  `);
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('UNKNOWN');
  const after = await performFollow(page, readOptions);
  expect(after.clicked).toBe(false);
  expect(after.relationship).toBe('UNKNOWN');
  await expect(page.locator('#suggested')).not.toHaveAttribute('data-clicked', 'true');
});

test('clica somente no controle primário quando há sugestão dentro do header', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <div>
          <a href="/alvo_real/"><h2>alvo_real</h2></a>
          <button id="primary" onclick="this.dataset.clicked='true'; this.textContent='Seguindo'">Seguir</button>
        </div>
        <div>20 posts 500 seguidores 300 seguindo</div>
      </section>
      <section>
        <h3>Sugestões para você</h3>
        <article>
          <a href="/outra_conta/">outra_conta</a>
          <button id="suggested" onclick="this.dataset.clicked='true'">Seguir</button>
        </article>
      </section>
    </header>
    <main><a href="/p/AAA/">Post</a></main>
  `);
  let extraNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      extraNavigations += 1;
    }
  });
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('NOT_FOLLOWING');
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_real',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
  expect(extraNavigations).toBe(0);
  await expect(page.locator('#primary')).toHaveAttribute('data-clicked', 'true');
  await expect(page.locator('#suggested')).not.toHaveAttribute('data-clicked', 'true');
});

test('aceita ação e estatísticas em blocos irmãos da área primária', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <div>
          <h2>alvo_blocos_irmaos</h2>
          <div>20 posts 500 seguidores 300 seguindo</div>
        </div>
        <div>
          <button id="primary" onclick="this.textContent='Seguindo'">Seguir</button>
        </div>
      </section>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_blocos_irmaos',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
});

test('aceita ações e dados em seções irmãs diretas do header', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_secoes_irmas</h2>
        <div><span>9 posts</span><span>122 seguidores</span><span>864 seguindo</span></div>
      </section>
      <section>
        <button id="primary" onclick="this.textContent='Seguindo'">Seguir</button>
        <button>Enviar mensagem</button>
      </section>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_secoes_irmas',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
  await expect(page.locator('#primary')).toHaveText('Seguindo');
});

test('ignora Suggested for you sem link de perfil', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_sem_botao_en</h2>
        <div>10 posts 100 followers 50 following</div>
      </section>
      <h3>Suggested for you</h3>
      <button id="suggested" onclick="this.dataset.clicked='true'">Follow</button>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_sem_botao_en',
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  await expect(page.locator('#suggested')).not.toHaveAttribute('data-clicked', 'true');
});

test('marcador responsivo oculto não bloqueia o botão principal', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_marcador_oculto</h2>
        <h2 style="display:none">alvo_marcador_oculto</h2>
        <div>20 posts 500 seguidores 300 seguindo</div>
        <h3 style="display:none">Sugestões para você</h3>
        <button onclick="this.textContent='Seguindo'">Seguir</button>
      </section>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_marcador_oculto',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
});

test('não aceita confirmação transitória antes de o DOM entrar em falha', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <div>
          <a href="/alvo_transitorio/"><h2>alvo_transitorio</h2></a>
          <button id="primary" onclick="
            this.textContent='Seguindo';
            setTimeout(() => {
              this.remove();
              document.querySelector('#content').textContent='Falha no carregamento.';
            }, 0)
          ">Seguir</button>
        </div>
        <div>20 posts 500 seguidores 300 seguindo</div>
      </section>
    </header>
    <main id="content"><a href="/p/AAA/">Post</a></main>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_transitorio',
    stabilityDelayMs: 10,
    confirmationTimeoutMs: 100,
  });
  expect(result).toEqual({ clicked: true, relationship: 'UNKNOWN' });
});

test('confirma pela resposta do clique quando o DOM entra em falha', async ({ page }) => {
  await page.route('https://www.instagram.com/api/follow-test', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: {
          username: 'alvo_rede',
          friendship_status: { following: true },
        },
      }),
    });
  });
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_rede</h2>
        <div>20 posts 500 seguidores 300 seguindo</div>
        <button onclick="
          fetch('https://www.instagram.com/api/follow-test');
          this.remove();
          document.querySelector('main').textContent='Falha no carregamento.';
        ">Seguir</button>
      </section>
    </header>
    <main>Conteúdo</main>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_rede',
    stabilityDelayMs: 10,
    confirmationTimeoutMs: 100,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
});

test('não confirma o alvo quando apenas uma sugestão muda para Seguindo', async ({ page }) => {
  await page.setContent(`
    <header>
      <h2>alvo_sem_confirmacao</h2>
      <div>20 posts 500 seguidores 300 seguindo</div>
      <button id="primary" onclick="
        document.querySelector('#suggested').textContent='Seguindo';
        this.remove();
      ">Seguir</button>
      <h3>Sugestões para você</h3>
      <article>
        <a href="/outra_conta/">outra_conta</a>
        <button id="suggested">Seguir</button>
      </article>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_sem_confirmacao',
    stabilityDelayMs: 10,
    confirmationTimeoutMs: 100,
  });
  expect(result).toEqual({ clicked: true, relationship: 'UNKNOWN' });
});

test('não confirma e não recarrega se surgir aviso de segurança após o clique', async ({
  page,
}) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_com_aviso</h2>
        <div>20 posts 500 seguidores 300 seguindo</div>
        <button onclick="
          this.textContent='Seguindo';
          document.body.insertAdjacentHTML('beforeend', '<div>Action blocked</div>');
        ">Seguir</button>
      </section>
    </header>
  `);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations += 1;
    }
  });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_com_aviso',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'UNKNOWN' });
  expect(navigations).toBe(0);
});

test('duplicidade de controles primários falha fechada sem clique', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <div><h2>alvo_duplicado</h2><button class="primary">Seguir</button><button class="primary">Seguir</button></div>
        <div>20 posts 500 seguidores 300 seguindo</div>
      </section>
    </header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_duplicado',
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
});

test('recarrega somente na exceção pós-clique sem confirmação', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <div><h2>alvo_inconclusivo</h2><button onclick="this.remove()">Seguir</button></div>
        <div>20 posts 500 seguidores 300 seguindo</div>
      </section>
    </header>
  `);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations += 1;
    }
  });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_inconclusivo',
    stabilityDelayMs: 10,
    confirmationTimeoutMs: 100,
  });
  expect(result).toEqual({ clicked: true, relationship: 'UNKNOWN' });
  expect(navigations).toBe(1);
});

test('confirma que o follow não foi aplicado quando Seguir permanece após a recarga', async ({
  page,
}) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page.getByTestId('follow-button').evaluate((button) => {
    button.removeAttribute('onclick');
  });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityDelayMs: 10,
    confirmationTimeoutMs: 100,
  });
  expect(result).toEqual({ clicked: true, relationship: 'NOT_FOLLOWING' });
});

test('não clica quando o cabeçalho pertence a outro username', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'outro_perfil',
    stabilityChecks: 3,
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/diverge do esperado/);
  await expect(page.getByTestId('follow-button')).toHaveAttribute('data-state', 'FOLLOW');
});

test('não clica quando o botão desaparece entre as leituras', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page.evaluate(
    `setTimeout(() => document.querySelector('[data-testid="follow-button"]')?.remove(), 500)`,
  );
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityChecks: 3,
    stabilityDelayMs: 1000,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/validação instável/);
});

test('falha de acionabilidade durante o trial vira skip sem clique', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_trial</h2>
        <div>20 posts 500 seguidores 300 seguindo</div>
        <div style="height:1600px"></div>
        <button id="primary">Seguir</button>
      </section>
    </header>
    <script>
      window.addEventListener('scroll', () => {
        document.querySelector('#primary')?.remove();
      }, { once: true });
    </script>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_trial',
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.relationship).toBe('UNKNOWN');
});

test('tolera substituição do botão pelo React antes do clique', async ({ page }) => {
  await page.setContent(`
    <header>
      <section>
        <h2>alvo_react</h2>
        <div>20 posts 500 seguidores 300 seguindo</div>
        <div style="height:1600px"></div>
        <button id="primary" onclick="this.textContent='Seguindo'">Seguir</button>
      </section>
    </header>
    <script>
      window.addEventListener('scroll', () => {
        const original = document.querySelector('#primary');
        if (!original) return;
        const replacement = original.cloneNode(true);
        replacement.id = 'replacement';
        original.replaceWith(replacement);
      }, { once: true });
    </script>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_react',
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
  await expect(page.locator('#replacement')).toHaveText('Seguindo');
});

test('segue quando a falha de carregamento está apenas na grade de publicações', async ({
  page,
}) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page
    .getByRole('main')
    .getByRole('link')
    .evaluate((element) => {
      element.textContent = 'Falha no carregamento.';
    });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityChecks: 3,
    stabilityDelayMs: 10,
  });
  expect(result).toEqual({ clicked: true, relationship: 'FOLLOWING' });
  await expect(page.getByTestId('follow-button')).toHaveAttribute('data-state', 'FOLLOWING');
});

test('não clica quando a falha de carregamento está no cabeçalho principal', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page.locator('header').evaluate((header) => {
    const failure = header.ownerDocument.createElement('div');
    failure.textContent = 'Falha no carregamento.';
    header.appendChild(failure);
  });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityChecks: 3,
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.relationship).toBe('UNKNOWN');
  expect(result.notClickedReason).toMatch(/Falha no carregamento.*cabeçalho principal/);
  await expect(page.getByTestId('follow-button')).toHaveAttribute('data-state', 'FOLLOW');
});

test('não clica quando a falha deixa o perfil sem controle principal', async ({ page }) => {
  await page.setContent(`
    <header><h2>alvo_sem_controle</h2><div>Falha no carregamento.</div></header>
  `);
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo_sem_controle',
    stabilityChecks: 2,
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/Falha no carregamento/);
});
