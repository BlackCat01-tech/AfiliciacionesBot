# Afiliaciones ARL Sura y Comfama — bot + panel

Un chat (Telegram o WhatsApp) pide los datos del trabajador uno por uno, confirma cada respuesta y,
al final, guarda la afiliación en Postgres. El panel web muestra y gestiona el estado ante ARL Sura y Comfama.

```
afiliaciones-bot/
├── server.js        bot, API y servidor del panel
├── schema.sql       tablas (el servidor las crea al arrancar)
├── package.json
├── .env.example     nombres de variables
├── .gitignore
└── public/index.html  panel
```

## 1. GitHub
Repositorio nuevo y **privado** (por ejemplo `afiliaciones-bot`). Sube todo el contenido, incluida la carpeta `public`.

## 2. Base de datos (Supabase)
1. Crea un proyecto en supabase.com.
2. En el botón **Connect** copia la cadena de conexión del *pooler* (compatible con IPv4) y reemplaza la contraseña.
   Esa cadena es tu `DATABASE_URL`. Los menús de Supabase cambian: busca la opción equivalente.

## 3. Despliegue (Render u otro)
Web Service desde el repo: Build `npm install`, Start `npm start`. Variables:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | cadena de Supabase |
| `PANEL_PASSWORD` | clave larga para entrar al panel (usuario: cualquiera) |
| `BASE_URL` | URL pública del servicio, sin `/` final |
| `PERMITIDOS` | IDs autorizados a usar el bot, separados por coma (ver paso 5) |

Sin `DATABASE_URL` o `PANEL_PASSWORD` el servidor no arranca. Abre la URL: el navegador pedirá la clave.

## 4. Telegram (pruebas)
1. En Telegram habla con **@BotFather** → `/newbot` → copia el token.
2. Agrega en el hosting `TELEGRAM_TOKEN` y `TELEGRAM_SECRET` (una clave inventada, solo letras, números, `_` o `-`).
3. Registra el webhook abriendo esta dirección en el navegador (con tus valores):
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<BASE_URL>/telegram&secret_token=<SECRET>`

## 5. Probar
1. Escríbele al bot `id`: responde con tu identificador. Agrégalo a `PERMITIDOS` y guarda.
2. Escribe `AFILIAR` y responde las preguntas. Comandos: `ATRAS`, `CANCELAR`, `AYUDA`.
3. Al `CONFIRMAR`, la afiliación aparece en el panel.

## 6. WhatsApp (cuando esté disponible)
- **Twilio:** variable `TWILIO_AUTH_TOKEN`; en el sandbox, "When a message comes in" = `<BASE_URL>/twilio` (POST).
  Las cuentas de prueba tienen restricciones de mensajes; si no responde, revisa los límites del trial.
- **Meta Cloud API:** variables `WA_VERIFY_TOKEN`, `WA_TOKEN`, `WA_PHONE_ID`, `APP_SECRET`;
  webhook = `<BASE_URL>/whatsapp`, suscrito al campo `messages`.
En ambos casos el ID autorizado es el número con indicativo y sin `+` (por ejemplo `573001112233`).

## Seguridad y límites
- Hay datos personales: usa solo datos ficticios hasta tener la autorización de tratamiento (Ley 1581) y el visto bueno del cliente.
- El panel usa clave básica sobre HTTPS; para producción conviene inicio de sesión con usuarios.
- La foto de la cédula se guarda solo como referencia del canal; guardar el archivo cifrado (p. ej. Supabase Storage) es el siguiente paso.
- Nunca subas tokens ni claves a GitHub; van en las variables del hosting.
