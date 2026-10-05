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
2. Define `EXPO_PUBLIC_API_URL` con la URL HTTPS del servidor BellezaAI desplegado.
3. Ejecuta `npm install`.
4. Ejecuta `npm start`.

No se guardan claves de OpenAI ni secretos del servidor dentro de la app móvil.
