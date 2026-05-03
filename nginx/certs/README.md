Place local TLS certificate material here for nginx when running HTTPS locally.

Required filenames:
- fullchain.pem
- privkey.pem

Do not commit certificate or private key files to version control.
Provision them locally from your certificate manager or development PKI.

For local development, a common flow is:
- `mkcert localhost 127.0.0.1 ::1`
- rename the generated certificate to `fullchain.pem`
- rename the generated key to `privkey.pem`

`npm run security:check` fails if certificate payloads in this folder are committed.