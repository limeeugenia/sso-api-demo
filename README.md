# SSO API demo

A small web app that shows the sign-in with an external identity provider through the Spryker API Platform (SOL-549):

- the **Storefront API** tab signs in a customer;
- the **Backend API** tab signs in a Back Office user or a merchant user.

The left pane is the sign-in UI. The right pane shows each step and each API call: API, request URL, proxy URL, headers, response, status and duration.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. One dev server serves both tabs. The port is fixed (`strictPort`), because the identity provider accepts only the approved redirect URI `http://localhost:3000/auth/callback`.

The browser calls each API through a Vite dev-server proxy:

| Tab | Proxy path | Default target | Override |
| --- | --- | --- | --- |
| Storefront API | `/glue-storefront/*` | `http://glue-storefront.eu.spryker.local` | `GLUE_STOREFRONT_URL` |
| Backend API | `/glue-backend/*` | `http://glue-backend.eu.spryker.local` | `GLUE_BACKEND_URL` |

```bash
GLUE_STOREFRONT_URL=http://glue-storefront.eu.spryker.local GLUE_BACKEND_URL=http://glue-backend.eu.spryker.local npm run dev
```

## Flow

No API request starts when the page opens. Each request starts from a button.

1. **Get all providers** sends `GET /identity-providers`. The app shows one sign-in button for each provider and puts the provider names in the suggestions of the name field.
2. **Get one provider** sends `GET /identity-providers/{identityProvider}` with the name from the field. You can type a name that is not in the list: an unknown or disabled provider gives `404` with the error code `006`.
3. A sign-in button makes a PKCE pair (S256), sends `POST /identity-providers/{identityProvider}/authorization-requests` and goes to the returned `authorizationUrl`.
4. The identity provider sends the browser back to `http://localhost:3000/auth/callback`. The app compares `state` and sends `POST /identity-providers/{identityProvider}/access-tokens`. The callback finishes in the tab that started the sign-in.
5. The app shows the tokens and the decoded JWT, and the endpoint test buttons for the tab.

## Storefront API tab

- The **Store** select (DE or AT) sets the `Store` header of each request. A store shows only the identity providers that are enabled for the Storefront API in that store. When you change the store, the app removes the last provider result.
- After the sign-in, **Get current customer** sends `GET /customers` with the access token.

## Backend API tab

- There is no store and no `Store` header. The token has no refresh token and no company user.
- After the sign-in, **GET /categories** and **GET /merchant-profile** call the Backend API with the token: a Back Office user gets `200` and `403`, a merchant user gets `403` and `200`.
- Local setup: the Keycloak client `spryker-backend-api` (realm `spryker`, redirect URI `http://localhost:3000/auth/callback`) and the Back Office configuration group **Backend API** with the provider `sso_backend_api_keycloak` and the same redirect URI.

## Notes

- A direct call from the browser to the API does not work: the Storefront API does not allow the `Store` header in CORS preflight, and its responses have no `Access-Control-Allow-Origin` header. Thus the app uses the proxy for both APIs.
- `sessionStorage` of the browser tab keeps the active tab, the store, the pending sign-in (code verifier, state and API type), the signed-in session of each tab and the log. Use one browser tab for the full flow. You can be signed in on both tabs at the same time.
- The provider results stay in memory only. After a reload, click **Get all providers** again.
- **Sign out** only removes the tokens of the tab from the browser tab. It does not revoke them.
