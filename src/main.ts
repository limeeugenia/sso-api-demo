import './style.css';
import { API_TARGETS, type ApiType, errorMessage, glueRequest } from './api';
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
  api: ApiType;
  provider: IdentityProvider;
  store?: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

interface Tokens {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  idCompanyUser?: string | null;
}

interface SignedInSession {
  provider: IdentityProvider;
  store?: string;
  tokens: Tokens;
  issuedAt: number;
}

interface Notice {
  kind: 'error';
  text: string;
}

// The last provider result of a tab. It stays in memory only.
interface ProviderResult {
  description: string;
  scope: string;
  providers: IdentityProvider[];
}

interface TabState {
  notice: Notice | null;
  loading: string | null;
  result: ProviderResult | null;
  // Provider names from the last "Get all providers" result. They fill the datalist of the name input.
  knownNames: string[];
  providerName: string;
  requestId: number;
}

const API_TYPES: ApiType[] = ['storefront', 'backend'];
const STORES = ['DE', 'AT'];
const BACKEND_API_PATHS = ['/categories', '/merchant-profile'];
const CALLBACK_PATH = '/auth/callback';
// Both APIs use the same redirect URI. The pending sign-in keeps the API type, so the callback finishes in the correct tab.
const REDIRECT_URI = location.origin + CALLBACK_PATH;
const KEY_TAB = 'demo.tab';
const KEY_STORE = 'demo.store';
const KEY_PENDING = 'demo.pending';
const KEY_SESSION_PREFIX = 'demo.session.';

const app = document.querySelector<HTMLDivElement>('#app')!;
const tabList = document.querySelector<HTMLElement>('#tabs')!;
const tabs: Record<ApiType, TabState> = { storefront: newTabState(), backend: newTabState() };
let activeTab = readActiveTab();

void boot();

async function boot(): Promise<void> {
  initLog(document.querySelector<HTMLOListElement>('#log')!, document.querySelector<HTMLElement>('.log-pane')!);
  document.querySelector('#clear-log')!.addEventListener('click', clearLog);

  if (location.pathname === CALLBACK_PATH) {
    await handleCallback();
  }

  // No API request starts on page load. Each request starts from a button.
  render();
}

function newTabState(): TabState {
  return { notice: null, loading: null, result: null, knownNames: [], providerName: '', requestId: 0 };
}

function isApiType(value: unknown): value is ApiType {
  return value === 'storefront' || value === 'backend';
}

function readActiveTab(): ApiType {
  const tab = readJson<unknown>(KEY_TAB);

  return isApiType(tab) ? tab : 'storefront';
}

function selectTab(api: ApiType): void {
  activeTab = api;
  writeJson(KEY_TAB, api);
  render();
}

function currentStore(): string {
  const store = readJson<string>(KEY_STORE);

  return store !== null && STORES.includes(store) ? store : STORES[0];
}

function changeStore(store: string): void {
  const tab = tabs.storefront;

  writeJson(KEY_STORE, store);
  // The result of the previous store is not valid for the new store. The app ignores a response that is still open.
  tab.requestId++;
  tab.loading = null;
  tab.result = null;
  tab.notice = null;
  render();
}

function sessionKey(api: ApiType): string {
  return KEY_SESSION_PREFIX + api;
}

function readSession(api: ApiType): SignedInSession | null {
  return readJson<SignedInSession>(sessionKey(api));
}

function scopeLabel(api: ApiType, store?: string): string {
  return api === 'backend' ? 'the Backend API' : `the Storefront API in store ${store}`;
}

function render(): void {
  const target = API_TARGETS[activeTab];
  const session = readSession(activeTab);

  document.querySelector('#target')!.textContent =
    `${target.label} ${target.url} (proxy ${target.proxyPrefix}) · redirect URI ${REDIRECT_URI}`;
  renderTabs();

  if (session) {
    renderSignedIn(activeTab, session);

    return;
  }

  renderProviderPanel(activeTab);
}

function renderIfActive(api: ApiType): void {
  if (api === activeTab) {
    render();
  }
}

function renderTabs(): void {
  tabList.replaceChildren(
    ...API_TYPES.map((api) =>
      el(
        'button',
        { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(api === activeTab), onClick: () => selectTab(api) },
        API_TARGETS[api].label,
        readSession(api) !== null && el('span', { class: 'tab-badge' }, 'signed in'),
      ),
    ),
  );
}

function renderProviderPanel(api: ApiType): void {
  const tab = tabs[api];
  const busy = tab.loading !== null;
  const inputId = `provider-name-${api}`;
  const datalistId = `provider-names-${api}`;

  app.replaceChildren(
    noticeView(tab),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Identity providers'),
      el(
        'p',
        { class: 'muted' },
        api === 'storefront'
          ? 'A request starts only when you click its button. The Store header contains the selected store.'
          : 'A request starts only when you click its button. The Backend API has no store, so the requests have no Store header.',
      ),
      api === 'storefront' && storeSwitch(),
      el(
        'div',
        { class: 'requests' },
        el(
          'div',
          { class: 'request-row' },
          el('code', { class: 'request-path' }, 'GET /identity-providers'),
          el('button', { class: 'button', type: 'button', disabled: busy, onClick: () => loadProviders(api, null) }, 'Get all providers'),
        ),
        el(
          'form',
          {
            class: 'request-row',
            onSubmit: (event) => {
              event.preventDefault();
              void loadOneProvider(api);
            },
          },
          el('label', { class: 'request-path', for: inputId }, 'GET /identity-providers/'),
          el('input', {
            id: inputId,
            type: 'text',
            list: datalistId,
            placeholder: '{identityProvider}',
            value: tab.providerName,
            autocomplete: 'off',
            spellcheck: 'false',
            onInput: (event) => {
              tab.providerName = (event.target as HTMLInputElement).value;
            },
          }),
          el('button', { class: 'button', type: 'submit', disabled: busy }, 'Get one provider'),
          el('datalist', { id: datalistId }, ...tab.knownNames.map((name) => el('option', { value: name }))),
        ),
      ),
    ),
    tab.loading !== null ? el('p', { class: 'muted' }, tab.loading) : tab.result ? providerResultView(api, tab.result) : '',
  );
}

function storeSwitch(): HTMLElement {
  const select = el('select', { id: 'store' }, ...STORES.map((store) => el('option', { value: store }, store)));

  select.value = currentStore();
  select.addEventListener('change', () => changeStore(select.value));

  return el('label', { class: 'store-switch' }, 'Store', select);
}

async function loadOneProvider(api: ApiType): Promise<void> {
  const name = tabs[api].providerName.trim();

  if (name === '') {
    tabs[api].notice = { kind: 'error', text: 'Type the name of an identity provider first.' };
    renderIfActive(api);

    return;
  }

  await loadProviders(api, name);
}

// name null: GET /identity-providers. Otherwise: GET /identity-providers/{identityProvider}.
async function loadProviders(api: ApiType, name: string | null): Promise<void> {
  const tab = tabs[api];
  const store = api === 'storefront' ? currentStore() : undefined;
  const scope = scopeLabel(api, store);
  const path = name === null ? '/identity-providers' : `/identity-providers/${encodeURIComponent(name)}`;
  const requestId = ++tab.requestId;

  tab.notice = null;
  tab.result = null;
  tab.loading = name === null ? `Loading the identity providers for ${scope}…` : `Loading the identity provider "${name}" for ${scope}…`;
  renderIfActive(api);

  const response = await glueRequest('GET', path, { api, store });

  if (requestId !== tab.requestId) {
    return;
  }

  tab.loading = null;

  if (!response.ok) {
    const subject = name === null ? 'the identity providers' : `the identity provider "${name}"`;

    tab.notice = { kind: 'error', text: `Could not load ${subject}. ${errorMessage(response)}` };
    renderIfActive(api);

    return;
  }

  const data = response.body?.data;
  const items: unknown[] = name === null ? (Array.isArray(data) ? data : []) : data ? [data] : [];
  const providers = items.map(toProvider);

  if (name === null) {
    tab.knownNames = providers.map((provider) => provider.name);
  }

  tab.result = {
    description: name === null ? `Identity providers enabled for ${scope}.` : `The identity provider "${name}" for ${scope}.`,
    scope,
    providers,
  };
  renderIfActive(api);
}

function toProvider(item: any): IdentityProvider {
  return { name: item?.attributes?.name ?? item?.id ?? '', linkText: item?.attributes?.linkText ?? '' };
}

function providerResultView(api: ApiType, result: ProviderResult): HTMLElement {
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, 'Sign in'),
    el('p', { class: 'muted' }, result.description),
    result.providers.length === 0
      ? el('p', { class: 'empty' }, `No identity providers are enabled for ${result.scope}.`)
      : el(
          'div',
          { class: 'provider-list' },
          ...result.providers.map((provider) =>
            el('button', { class: 'button', type: 'button', onClick: () => startSignIn(api, provider) }, provider.linkText || provider.name),
          ),
        ),
  );
}

async function startSignIn(api: ApiType, provider: IdentityProvider): Promise<void> {
  const store = api === 'storefront' ? currentStore() : undefined;

  tabs[api].notice = null;
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
    api,
    store,
    resourceType: 'identity-provider-authorization-requests',
    attributes: { redirectUri: REDIRECT_URI, codeChallenge },
  });
  const attributes = response.body?.data?.attributes;

  if (!response.ok || !attributes?.authorizationUrl || !attributes?.state) {
    const reason = response.ok ? 'The response has no authorizationUrl or state.' : errorMessage(response);

    tabs[api].notice = { kind: 'error', text: `Could not start the sign-in. ${reason}` };
    renderIfActive(api);

    return;
  }

  const pending: PendingSignIn = { api, provider, store, codeVerifier, state: attributes.state, redirectUri: REDIRECT_URI };

  writeJson(KEY_PENDING, pending);
  addLog({
    kind: 'step',
    title: `Redirect to the identity provider (${provider.name})`,
    sections: [
      { label: 'Authorization URL', content: attributes.authorizationUrl },
      { label: 'Query parameters', content: queryParameters(attributes.authorizationUrl) },
      { label: 'Saved in sessionStorage', content: { api, state: pending.state, codeVerifier, store } },
    ],
  });

  app.replaceChildren(el('p', { class: 'muted' }, `Redirecting to ${provider.linkText}…`));
  location.assign(attributes.authorizationUrl);
}

async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const pending = readJson<PendingSignIn>(KEY_PENDING);
  // The pending sign-in tells which API started the sign-in. Without it, the callback shows its result in the active tab.
  const api = pending !== null && isApiType(pending.api) ? pending.api : activeTab;

  removeKey(KEY_PENDING);
  history.replaceState(null, '', '/');
  activeTab = api;
  writeJson(KEY_TAB, api);

  addLog({
    kind: 'step',
    title: `Callback received from the identity provider (${API_TARGETS[api].label})`,
    sections: [{ label: 'Query parameters', content: Object.fromEntries(params) }],
  });

  if (params.has('error')) {
    const description = params.get('error_description');

    fail(api, `The identity provider returned an error: ${params.get('error')}${description ? ` (${description})` : ''}.`);

    return;
  }

  if (!pending) {
    fail(api, 'No sign-in was started in this browser tab, so the app has no code verifier for this callback.');

    return;
  }

  const stateCheck = { expected: pending.state, received: params.get('state') };

  if (stateCheck.received !== pending.state) {
    fail(api, 'The state of the callback does not match. The app rejected the callback.', stateCheck);

    return;
  }

  addLog({ kind: 'step', title: 'State check passed', sections: [{ label: 'Values', content: stateCheck }] });

  const code = params.get('code');

  if (!code) {
    fail(api, 'The callback has no authorization code.');

    return;
  }

  if (api === 'storefront' && pending.store) {
    writeJson(KEY_STORE, pending.store);
  }

  const response = await glueRequest('POST', `/identity-providers/${encodeURIComponent(pending.provider.name)}/access-tokens`, {
    api,
    store: pending.store,
    resourceType: 'identity-provider-access-tokens',
    attributes: { code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri },
  });
  const data = response.body?.data;
  const accessToken: string | undefined = data?.attributes?.accessToken ?? data?.id;

  if (!response.ok || !accessToken) {
    tabs[api].notice = {
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

  writeJson(sessionKey(api), session);
}

function renderSignedIn(api: ApiType, session: SignedInSession): void {
  const isBackendApi = api === 'backend';
  const { tokens } = session;
  const expiresAt = new Date(session.issuedAt + tokens.expiresIn * 1000);
  const customerResult = el('div');

  app.replaceChildren(
    noticeView(tabs[api]),
    el(
      'section',
      { class: 'card' },
      el(
        'div',
        { class: 'card-head' },
        el('h2', {}, 'Signed in'),
        el('span', { class: 'pill' }, isBackendApi ? `${session.provider.linkText} · Backend API` : `${session.provider.linkText} · store ${session.store}`),
      ),
      el(
        'dl',
        { class: 'fields' },
        field('Token type', tokens.tokenType),
        field('Expires in', `${tokens.expiresIn} s (at ${expiresAt.toLocaleTimeString('en-GB')})`),
        !isBackendApi && field('Company user', tokens.idCompanyUser ?? 'none (plain customer sign-in)'),
      ),
      tokenBlock('Access token', tokens.accessToken),
      tokens.refreshToken ? tokenBlock('Refresh token', tokens.refreshToken) : el('p', { class: 'muted' }, 'No refresh token: sign in again when the access token expires.'),
      jwtView(tokens.accessToken),
      el(
        'div',
        { class: 'actions' },
        ...(isBackendApi
          ? BACKEND_API_PATHS.map((path) =>
              el('button', { class: 'button', type: 'button', onClick: () => loadBackendResource(session, path, customerResult) }, `GET ${path}`),
            )
          : [el('button', { class: 'button', type: 'button', onClick: () => loadCustomer(session, customerResult) }, 'Get current customer')]),
        el('button', { class: 'button button-secondary', type: 'button', onClick: () => signOut(api) }, 'Sign out'),
      ),
    ),
    customerResult,
  );
}

async function loadBackendResource(session: SignedInSession, path: string, target: HTMLElement): Promise<void> {
  target.replaceChildren(el('p', { class: 'muted' }, `Loading ${path}…`));

  const response = await glueRequest('GET', path, { api: 'backend', accessToken: session.tokens.accessToken });

  if (!response.ok) {
    target.replaceChildren(el('div', { class: 'notice notice-error' }, `GET ${path} was rejected. ${errorMessage(response)}`));

    return;
  }

  const data = response.body?.data;
  const items = Array.isArray(data) ? data : [data];

  target.replaceChildren(
    el(
      'section',
      { class: 'card' },
      el('h2', {}, `GET ${path}: HTTP ${response.status}`),
      el('p', { class: 'muted' }, `${items.length} resource(s). The first one:`),
      el('pre', {}, JSON.stringify(items[0] ?? null, null, 2)),
    ),
  );
}

async function loadCustomer(session: SignedInSession, target: HTMLElement): Promise<void> {
  target.replaceChildren(el('p', { class: 'muted' }, 'Loading the current customer…'));

  const response = await glueRequest('GET', '/customers', { api: 'storefront', store: session.store, accessToken: session.tokens.accessToken });
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

function signOut(api: ApiType): void {
  removeKey(sessionKey(api));
  addLog({
    kind: 'step',
    title: `Signed out of the ${API_TARGETS[api].label} in the demo app`,
    sections: [{ label: 'Note', content: 'The tokens were removed from sessionStorage. No API call revokes them.' }],
  });
  tabs[api].notice = null;
  render();
}

function fail(api: ApiType, text: string, details?: unknown): void {
  addLog({ kind: 'error', title: text, sections: details === undefined ? [] : [{ label: 'Values', content: details }] });
  tabs[api].notice = { kind: 'error', text };
}

function noticeView(tab: TabState): HTMLElement | string {
  const { notice } = tab;

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
