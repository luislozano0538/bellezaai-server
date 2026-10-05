# BellezaAI Mobile

Primera base móvil de BellezaAI para iPhone y Android usando Expo/React Native.

## Incluido
- Inicio de sesión con el backend existente.
- Sesión guardada de forma segura con SecureStore.
- Panel con métricas del salón.
- Lista de próximas citas.
- Vista de todas las citas.
- Vista de clientes.
- Navegación móvil básica.

## Configuración
1. Copia `.env.example` a `.env`.
2. La app usa por defecto `https://bellezaai-server.onrender.com`. Puedes sobrescribirlo con `EXPO_PUBLIC_API_URL` si cambias de servidor.
3. Ejecuta `npm install`.
4. Ejecuta `npm start`.

No se guardan claves de OpenAI ni secretos del servidor dentro de la app móvil.


## Compilar para instalar
La configuración `eas.json` incluye:
- `preview`: distribución interna para probar una compilación.
- `production`: compilación para App Store / Google Play con incremento automático de versión.

Después de vincular el proyecto a una cuenta de Expo/EAS:
- iPhone: `eas build --platform ios --profile preview`
- Android: `eas build --platform android --profile preview`
- Producción: `eas build --platform all --profile production`

La publicación final requiere las cuentas y credenciales de Apple/Google correspondientes.


## Vincular Expo/EAS y crear la primera build de iPhone

Este repositorio no guarda credenciales de Expo ni Apple.

1. Desde la carpeta `mobile/`, inicia sesión:
   `npx eas-cli login`
2. Comprueba la cuenta:
   `npm run eas:whoami`
3. Vincula BellezaAI a EAS:
   `npm run eas:init`
   Este paso crea el proyecto en Expo y añade `extra.eas.projectId` a `app.json`.
4. Para una build interna de iPhone, registra el dispositivo:
   `npm run device:ios`
5. Lanza la build:
   `npm run build:ios:preview`

La build `preview` usa distribución interna. En iOS, el dispositivo debe estar incluido en el perfil ad hoc para instalar la app.

### Automatización futura

Para builds desde CI se puede usar un token de Expo llamado `EXPO_TOKEN`. Nunca debe escribirse ese token dentro del repositorio; debe guardarse como secreto de GitHub/EAS.


## Backend staging para la build preview

Antes de crear la build `preview`, despliega esta rama en un backend de prueba separado.

Requisitos recomendados:
- rama del servidor: `mobile-app-foundation`
- servicio separado, por ejemplo `bellezaai-staging`
- base de datos PostgreSQL separada de producción
- `JWT_SECRET` distinto al de producción
- `OPENAI_API_KEY` solo si se quiere probar la pestaña IA
- las demás variables secretas del servidor se configuran en el proveedor, nunca en GitHub

Después configura en el entorno `preview` de EAS:

`EXPO_PUBLIC_API_URL=https://TU-BACKEND-STAGING`

La build preview está protegida para no usar automáticamente
`https://bellezaai-server.onrender.com`. Si falta la URL de staging, las llamadas API fallarán en lugar de tocar producción.
