import './style.css';
import { errorMessage, glueRequest } from './api';
import { el } from './dom';
import { decodeJwt, parseSubject } from './jwt';
import { addLog, clearLog, initLog } from './log';
import { createCodeChallenge, createCodeVerifier } from './pkce';
import { readJson, removeKey, writeJson } from './storage';

interface IdentityProvider {
  name: string;
  linkText: string;
}

interface PendingSignIn {
  provider: IdentityProvider;
  store: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

interface Tokens {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  idCompanyUser: string | null;
}

interface SignedInSession {
  provider: IdentityProvider;
  store: string;
  tokens: Tokens;
  issuedAt: number;
}

interface Notice {
  kind: 'error';
  text: string;
}

const STORES = ['DE', 'AT'];
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = location.origin + CALLBACK_PATH;
const KEY_STORE = 'demo.store';
const KEY_PENDING = 'demo.pending';
const KEY_SESSION = 'demo.session';

const app = document.querySelector<HTMLDivElement>('#app')!;
const storeSelect = document.querySelector<HTMLSelectElement>('#store')!;
let notice: Notice | null = null;
let renderCounter = 0;

void boot();

async function boot(): Promise<void> {
  initLog(document.querySelector<HTMLOListElement>('#log')!, document.querySelector<HTMLElement>('.log-pane')!);
  document.querySelector('#clear-log')!.addEventListener('click', clearLog);
  document.querySelector('#target')!.textContent = `API ${__GLUE_URL__} · redirect URI ${REDIRECT_URI}`;

  storeSelect.replaceChildren(...STORES.map((store) => el('option', { value: store }, store)));
  storeSelect.value = currentStore();
  storeSelect.addEventListener('change', () => {
    writeJson(KEY_STORE, storeSelect.value);
    notice = null;
    render();
  });

  if (location.pathname === CALLBACK_PATH) {
    await handleCallback();
  }

  render();
}

function currentStore(): string {
  const store = readJson<string>(KEY_STORE);

  return store !== null && STORES.includes(store) ? store : STORES[0];
}

function render(): void {
  const session = readJson<SignedInSession>(KEY_SESSION);

  storeSelect.disabled = session !== null;

  if (session) {
    renderSignedIn(session);

    return;
  }

  void renderProviders();
}

async function renderProviders(): Promise<void> {
  const renderId = ++renderCounter;
  const store = currentStore();

  app.replaceChildren(noticeView(), el('p', { class: 'muted' }, `Loading identity providers for store ${store}…`));

  const response = await glueRequest('GET', '/identity-providers', { store });

  if (renderId !== renderCounter) {
    return;
  }

  if (!response.ok) {
    app.replaceChildren(
      noticeView(),
      el('div', { class: 'notice notice-error' }, `Could not load the identity providers. ${errorMessage(response)}`),
    );

    return;
  }

  const providers: IdentityProvider[] = (response.body?.data ?? []).map(
    (item: { attributes: IdentityProvider }) => ({ name: item.attributes.name, linkText: item.attributes.linkText }),
  );

  app.replaceChildren(
    noticeView(),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Sign in'),
      el('p', { class: 'muted' }, `Identity providers enabled for the Storefront API in store ${store}.`),
      providers.length === 0
        ? el('p', { class: 'empty' }, `No identity providers are enabled for store ${store}.`)
        : el(
            'div',
            { class: 'provider-list' },
            ...providers.map((provider) =>
              el('button', { class: 'button', type: 'button', onClick: () => startSignIn(provider) }, provider.linkText || provider.name),
            ),
          ),
    ),
  );
}

async function startSignIn(provider: IdentityProvider): Promise<void> {
  const store = currentStore();

  notice = null;
  app.querySelectorAll('button').forEach((button) => (button.disabled = true));

  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);

  addLog({
    kind: 'step',
    title: 'PKCE pair created in the browser',
    sections: [
      {
        label: 'Values',
        content: {
          codeVerifier,
          codeChallenge,
          codeChallengeMethod: 'S256',
          note: 'The verifier stays in sessionStorage. Only the challenge goes to the API.',
        },
      },
    ],
  });

  const response = await glueRequest('POST', `/identity-providers/${encodeURIComponent(provider.name)}/authorization-requests`, {
    store,
    resourceType: 'identity-provider-authorization-requests',
    attributes: { redirectUri: REDIRECT_URI, codeChallenge },
  });
  const attributes = response.body?.data?.attributes;

  if (!response.ok || !attributes?.authorizationUrl || !attributes?.state) {
    const reason = response.ok ? 'The response has no authorizationUrl or state.' : errorMessage(response);

    notice = { kind: 'error', text: `Could not start the sign-in. ${reason}` };
    render();

    return;
  }

  const pending: PendingSignIn = { provider, store, codeVerifier, state: attributes.state, redirectUri: REDIRECT_URI };

  writeJson(KEY_PENDING, pending);
  addLog({
    kind: 'step',
    title: `Redirect to the identity provider (${provider.name})`,
    sections: [
      { label: 'Authorization URL', content: attributes.authorizationUrl },
      { label: 'Query parameters', content: queryParameters(attributes.authorizationUrl) },
      { label: 'Saved in sessionStorage', content: { state: pending.state, codeVerifier, store } },
    ],
  });

  app.replaceChildren(el('p', { class: 'muted' }, `Redirecting to ${provider.linkText}…`));
  location.assign(attributes.authorizationUrl);
}

async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const pending = readJson<PendingSignIn>(KEY_PENDING);

  removeKey(KEY_PENDING);
  history.replaceState(null, '', '/');

  addLog({
    kind: 'step',
    title: 'Callback received from the identity provider',
    sections: [{ label: 'Query parameters', content: Object.fromEntries(params) }],
  });

  if (params.has('error')) {
    const description = params.get('error_description');

    fail(`The identity provider returned an error: ${params.get('error')}${description ? ` (${description})` : ''}.`);

    return;
  }

  if (!pending) {
    fail('No sign-in was started in this browser tab, so the app has no code verifier for this callback.');

    return;
  }

  const stateCheck = { expected: pending.state, received: params.get('state') };

  if (stateCheck.received !== pending.state) {
    fail('The state of the callback does not match. The app rejected the callback.', stateCheck);

    return;
  }

  addLog({ kind: 'step', title: 'State check passed', sections: [{ label: 'Values', content: stateCheck }] });

  const code = params.get('code');

  if (!code) {
    fail('The callback has no authorization code.');

    return;
  }

  storeSelect.value = pending.store;
  writeJson(KEY_STORE, pending.store);

  const response = await glueRequest('POST', `/identity-providers/${encodeURIComponent(pending.provider.name)}/access-tokens`, {
    store: pending.store,
    resourceType: 'identity-provider-access-tokens',
    attributes: { code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri },
  });
  const data = response.body?.data;
  const accessToken: string | undefined = data?.attributes?.accessToken ?? data?.id;

  if (!response.ok || !accessToken) {
    notice = {
      kind: 'error',
      text: `The sign-in failed. ${response.ok ? 'The response has no access token.' : errorMessage(response)}`,
    };

    return;
  }

  const session: SignedInSession = {
    provider: pending.provider,
    store: pending.store,
    tokens: { ...data.attributes, accessToken },
    issuedAt: Date.now(),
  };

  writeJson(KEY_SESSION, session);
}

function renderSignedIn(session: SignedInSession): void {
  renderCounter++;

  const { tokens } = session;
  const expiresAt = new Date(session.issuedAt + tokens.expiresIn * 1000);
  const customerResult = el('div');

  app.replaceChildren(
    noticeView(),
    el(
      'section',
      { class: 'card' },
      el(
        'div',
        { class: 'card-head' },
        el('h2', {}, 'Signed in'),
        el('span', { class: 'pill' }, `${session.provider.linkText} · store ${session.store}`),
      ),
      el(
        'dl',
        { class: 'fields' },
        field('Token type', tokens.tokenType),
        field('Expires in', `${tokens.expiresIn} s (at ${expiresAt.toLocaleTimeString('en-GB')})`),
        field('Company user', tokens.idCompanyUser ?? 'none (plain customer sign-in)'),
      ),
      tokenBlock('Access token', tokens.accessToken),
      tokenBlock('Refresh token', tokens.refreshToken),
      jwtView(tokens.accessToken),
      el(
        'div',
        { class: 'actions' },
        el('button', { class: 'button', type: 'button', onClick: () => loadCustomer(session, customerResult) }, 'Get current customer'),
        el('button', { class: 'button button-secondary', type: 'button', onClick: signOut }, 'Sign out'),
      ),
    ),
    customerResult,
  );
}

async function loadCustomer(session: SignedInSession, target: HTMLElement): Promise<void> {
  target.replaceChildren(el('p', { class: 'muted' }, 'Loading the current customer…'));

  const response = await glueRequest('GET', '/customers', { store: session.store, accessToken: session.tokens.accessToken });
  const data = response.body?.data;
  const customer = Array.isArray(data) ? data[0] : data;

  if (!response.ok || !customer) {
    const reason = response.ok ? 'The response has no customer.' : errorMessage(response);

    target.replaceChildren(el('div', { class: 'notice notice-error' }, `Could not load the customer. ${reason}`));

    return;
  }

  const values: Record<string, unknown> = { id: customer.id, ...customer.attributes };

  target.replaceChildren(
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Current customer'),
      el(
        'dl',
        { class: 'fields' },
        ...Object.entries(values).map(([name, value]) =>
          field(name, value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)),
        ),
      ),
    ),
  );
}

function signOut(): void {
  removeKey(KEY_SESSION);
  addLog({
    kind: 'step',
    title: 'Signed out in the demo app',
    sections: [{ label: 'Note', content: 'The tokens were removed from sessionStorage. No API call revokes them.' }],
  });
  notice = null;
  render();
}

function fail(text: string, details?: unknown): void {
  addLog({ kind: 'error', title: text, sections: details === undefined ? [] : [{ label: 'Values', content: details }] });
  notice = { kind: 'error', text };
}

function noticeView(): HTMLElement | string {
  return notice ? el('div', { class: `notice notice-${notice.kind}` }, notice.text) : '';
}

function field(label: string, value: string): HTMLElement {
  return el('div', { class: 'field' }, el('dt', {}, label), el('dd', {}, value));
}

function tokenBlock(label: string, value: string): HTMLElement {
  const copyButton = el('button', { class: 'link-button', type: 'button' }, 'Copy');

  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    copyButton.textContent = 'Copied';
    setTimeout(() => (copyButton.textContent = 'Copy'), 1200);
  });

  return el(
    'div',
    { class: 'token' },
    el('div', { class: 'token-head' }, el('span', { class: 'label' }, label), copyButton),
    el('code', { class: 'token-value' }, value),
  );
}

function jwtView(token: string): HTMLElement {
  const decoded = decodeJwt(token);

  if (!decoded) {
    return el('p', { class: 'muted' }, 'The access token is not a readable JWT.');
  }

  const subject = parseSubject(decoded.payload);

  return el(
    'details',
    { class: 'jwt', open: true },
    el('summary', {}, 'Decoded access token (JWT)'),
    el('div', { class: 'label' }, 'Header'),
    el('pre', {}, JSON.stringify(decoded.header, null, 2)),
    el('div', { class: 'label' }, 'Payload'),
    el('pre', {}, JSON.stringify(decoded.payload, null, 2)),
    subject !== null && el('div', { class: 'label' }, 'Subject (sub, parsed)'),
    subject !== null && el('pre', {}, JSON.stringify(subject, null, 2)),
  );
}

function queryParameters(url: string): Record<string, string> | string {
  try {
    return Object.fromEntries(new URL(url).searchParams);
  } catch {
    return 'The authorization URL is not a valid URL.';
  }
}
