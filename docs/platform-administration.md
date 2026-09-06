# Plattformverwaltung

`/` ist der Mitarbeiterbereich für Gespräche, Tickets, Wissen, Kunden, Analysen und das eigene Profil. `/admin` ist die getrennte Plattformverwaltung. Nur die in der Datenbank hinterlegte Systemrolle `superadmin` erlaubt den Zugriff; Organisationsrollen `owner` und `admin` reichen nicht aus.

Die Organisationsauswahl umfasst alle Organisationen. Einstellungen bleiben organisationsbezogen und werden von den bestehenden Laufzeitdiensten verwendet. Es werden keine globalen Standardwerte auf andere Organisationen kopiert.

Bereiche: KI-Routing, Provider-Schlüssel, Kontingente, Organisation, Sicherheit, Änderungsprotokoll sowie die bestehenden Assistenten- und Widget-Editoren. Infrastrukturkonfiguration wie Datenbank, Redis und Deployment-Secrets bleibt in der Betriebsumgebung. Die vorhandenen Felder für Kostenwarnung und Schlüsselrotation stellen noch keinen automatischen Benachrichtigungs- oder Rotationsdienst bereit.

## GitHub Issues für KI-Eskalationen

Unter **Plattformverwaltung → GitHub** kann für jede Organisation ein Repository im Format `organisation/repository` und ein GitHub Fine-grained Personal Access Token hinterlegt werden. Der Token benötigt für dieses Repository mindestens die Berechtigung **Issues: Read and write**. Nach dem Verbindungstest die Option **GitHub Issues für KI-Eskalationen aktivieren** speichern.

Ab diesem Zeitpunkt erzeugt jedes neue automatische KI-Eskalationsticket genau ein GitHub Issue. Bereits offene Eskalationen einer Unterhaltung werden weiter dedupliziert und erstellen kein weiteres Issue. Manuell erstellte Tickets werden nicht exportiert. SupportAI speichert die Issue-Nummer, URL und einen eventuellen Synchronisationsfehler am lokalen Ticket. Fällt GitHub aus, bleibt das interne Ticket offen und für Mitarbeiter bearbeitbar. Im Issue werden keine Kundenidentitäten exportiert; übertragen werden Ticketnummer, Priorität, Tags und die bereits für die Eskalation erzeugte Beschreibung.

## Active Directory Anmeldung

Unter **Plattformverwaltung → Sicherheit** lässt sich Active Directory pro Organisation aktivieren. Die Einrichtung benötigt eine `ldaps://`-Adresse auf Port 636, Base DN, Bind DN und das Passwort des Bind-Kontos. LDAPS ist verpflichtend; LDAP ohne Transportverschlüsselung, URLs mit Zugangsdaten und Zertifikate mit ungültiger Vertrauenskette werden abgelehnt. Das Bind-Passwort wird verschlüsselt gespeichert und nicht wieder ausgegeben.

Beim Login wird zunächst das lokale Passwort geprüft. Falls dies nicht passt, wird für die bestehenden Organisationsmitgliedschaften des Kontos Active Directory geprüft. Das AD-Konto wird über `userPrincipalName`, `mail` oder `sAMAccountName` gefunden und danach mit dessen Passwort gebunden. Es werden keine Benutzer automatisch importiert und keine Rollen aus Active Directory übernommen; die bestehende Organisationsmitgliedschaft bleibt die maßgebliche Berechtigung.

## Ersten Plattformadministrator einrichten

Ein bestehendes Konto kann durch einen Betreiber mit Datenbankzugriff gezielt freigeschaltet werden:

```sh
cd backend
npm run build
node dist/scripts/grantPlatformAdmin.js admin@example.com
```

Danach erneut anmelden. Bestehende Tokens werden bei der Freischaltung ungültig. Registrierung vergibt niemals automatisch die Plattformrolle. Der Befehl wurde bei der Implementierung nicht auf ein Benutzerkonto angewendet.

## Prüfung

```sh
npm --prefix backend run build
node backend/dist/tests/platformAdmin.test.js
node backend/dist/tests/githubIssueService.test.js
node backend/dist/tests/activeDirectoryService.test.js
npm --prefix frontend run build
```

Für den Betriebstest mit laufender Datenbank: als Mitarbeiter einen direkten Admin-API-Zugriff versuchen (403), als Plattformadministrator zwei Organisationen auswählen, Einstellungen speichern und nach Neuladen prüfen. Änderungen dürfen ausschließlich die ausgewählte Organisation betreffen.
# Platform administration and organization access

The first global administrator is created only through `GET /setup/platform-admin` and `POST /api/v1/auth/setup/platform-admin`. The API transaction takes a PostgreSQL advisory lock and checks for an existing global `superadmin` role; a second request receives `PLATFORM_ADMIN_ALREADY_EXISTS`.

There is no public account registration. `POST /api/v1/auth/register` always returns `PUBLIC_REGISTRATION_DISABLED`. Organization access is granted through a seven-day invitation or configured Microsoft Entra ID SSO.

Invitation URLs contain a 256-bit random token, but the database retains only its SHA-256 digest. Acceptance locks the invitation row, verifies the organization status, expiration and recipient email, then creates the membership and marks the invitation accepted in one transaction. An existing account must authenticate and call the existing-account acceptance endpoint; no second identity is created.

Entra configuration is organization-owned and available at `GET`/`PATCH /api/v1/organizations/current/auth-settings` to an Owner. The client secret is encrypted at rest. The OIDC callback validates signed state, nonce, issuer, audience, expiry, tenant ID and Microsoft JWKS signature. SSO uses a pending invite by default. Domain auto-join is explicit, requires an exact normalized allow-list domain and is restricted to `agent` or `viewer`.

Global platform admins manage organizations through `/api/v1/platform-admin`. They have no implicit organization membership. To work in a tenant context they must create a documented support session with a reason (maximum 30 minutes) and send its ID as `X-Support-Session-Id`; each start and end is audited.
