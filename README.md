# SSO API demo

A small web app that shows the customer sign-in with an external identity provider through the Spryker Storefront API (SOL-549).

The left pane is the sign-in UI. The right pane shows each step and each API call: request, response, status and duration.

## Flow

1. `GET /identity-providers`: the app shows one button for each provider of the selected store (DE or AT).
2. On click, the app makes a PKCE pair (S256), sends `POST /identity-providers/{identityProvider}/authorization-requests` and goes to the returned `authorizationUrl`.
3. The identity provider sends the browser back to `http://localhost:3000/auth/callback`. The app compares `state` and sends `POST /identity-providers/{identityProvider}/access-tokens`.
4. The app shows the tokens and the decoded JWT. **Get current customer** sends `GET /customers` with the access token.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The port is fixed (`strictPort`), because the identity provider accepts only the approved redirect URI `http://localhost:3000/auth/callback`.

To use a different Glue Storefront host:

```bash
GLUE_URL=http://glue-storefront.eu.spryker.local npm run dev
```

## Notes

- The browser calls the API through the Vite dev-server proxy (`/glue/*`). A direct call does not work: the Storefront API does not allow the `Store` header in CORS preflight, and its responses have no `Access-Control-Allow-Origin` header.
- The code verifier, the state, the tokens and the log stay in `sessionStorage` of the browser tab. Use one tab for the full flow.
- A store shows only the identity providers that are enabled for the Storefront API in that store.
- **Sign out** only removes the tokens from the browser tab. It does not revoke them.
