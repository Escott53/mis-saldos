# Mis Saldos

PWA personal (es-ES, pensada para el móvil) para ver de un vistazo el patrimonio repartido entre varias cuentas:
Ledger (cripto), DEGIRO, Mapfre, Horos AM y cuentas personalizadas.

- HTML/CSS/JS estático, sin frameworks, sin backend, sin analítica.
- Instalable (manifest + service worker, funciona sin conexión).
- **Todos los datos se guardan solo en el dispositivo, cifrados.**
- Arranca vacía: no incluye ningún dato de ejemplo.

## Qué se actualiza solo y qué a mano

| Cuenta | Automático | Manual |
|---|---|---|
| **Ledger** | Saldos de direcciones públicas BTC / ETH / SOL, cuentas BTC por xpub/ypub/zpub y precios en EUR | Cantidades de otras criptos (LTC, ADA, XRP, DOT, DOGE, AVAX, USDC, USDT…): la cantidad es manual y el precio en EUR se actualiza solo |
| **DEGIRO** | — | Importar `Portfolio.csv` (Cartera → Exportar → CSV) o escribir el saldo total |
| **Mapfre** | — | Uno o varios productos (nombre + importe), con historial de cambios |
| **Horos AM** | Valor liquidativo (VL) diario de cada fondo/plan | Número de participaciones; VL manual si la fuente automática falla |
| **Personalizadas** | — | Nombre, emoji, color, saldo y enlace |

Los datos automáticos se refrescan al desbloquear (si han pasado más de 15 min) y con el botón ⟳.
Cada vez que cambia el total se guarda una instantánea para la gráfica de evolución.

## APIs usadas (públicas, gratuitas, sin clave, con CORS; verificadas desde Chromium)

| Dato | Principal | Alternativas |
|---|---|---|
| Saldo de dirección BTC | `mempool.space/api/address/{addr}` | `blockstream.info/api`, `blockchain.info/balance` |
| Cuenta BTC por xpub | Direcciones derivadas **en el móvil** + `blockchain.info/balance?active=a|b|…` (lotes de 20) | `mempool.space` por dirección |
| Saldo ETH | `ethereum-rpc.publicnode.com` (`eth_getBalance`) | `eth.drpc.org`, `cloudflare-eth.com` |
| Saldo SOL | `solana-rpc.publicnode.com` (`getBalance`) | `api.mainnet-beta.solana.com` |
| Precios EUR | `api.coingecko.com/api/v3/simple/price` | `api.coinbase.com/v2/exchange-rates?currency=EUR` |
| VL Horos | `horosam.com/api/pricesLast_{id}.json` | VL manual |

Notas:
- CoinGecko aplica límites por IP; cuando responde 429 lo hace sin cabeceras CORS, por eso existe la alternativa de Coinbase.
- `cloudflare-eth.com` devolvía errores en las pruebas y `api.mainnet-beta.solana.com` devolvía 403 al navegador; se mantienen solo como últimas alternativas.
- **xpub:** `blockchain.info/multiaddr` acepta xpub pero solo deriva direcciones *legacy*, y Ledger Live muestra «xpub» también para cuentas Native SegWit. Por eso la app deriva las direcciones en el propio dispositivo (secp256k1/BIP32, Legacy, SegWit anidada, Native SegWit y Taproot; comprobado con los vectores de BIP44/49/84/86) y solo envía **direcciones** a la API. La xpub nunca sale del móvil. Se escanean las cadenas de recepción y de cambio con un margen de 20 direcciones.
- ETH: solo el saldo nativo de ETH (no tokens ERC-20 ni redes L2).

### Horos: fuentes de valor liquidativo

La web pública de Horos rellena sus VL con ficheros JSON estáticos servidos con `Access-Control-Allow-Origin: *`,
así que se pueden leer desde el navegador:

| Producto | ISIN / código | id del JSON |
|---|---|---|
| Horos Value Internacional FI | ES0146309002 | `5a017ae36ccb761f259a0435` |
| Horos Value Iberia FI | ES0146311008 | `5acf59f6bf4c77472b24604e` |
| Horos Patrimonio FI, Clase A | ES0146296001 | `68ee056f0a76bc2aac4570dd` |
| Horos Patrimonio FI, Clase I | ES0146296019 | `68ee05a90a76bc2aac45711e` |
| Horos Internacional, PP | DGS N5263 | `5a72ee1de80f510f3c273aed` |
| Horos Internacional Empleo, PPE | — | `649d7e1165569400089ec6f8` |
| Horos Internacional Autónomos, PPES | — | `65f1e33cb391e502edcc575f` |

Respuesta: `{"date":"…","dateAsString":"AAAAMMDD","price":213.539…}`. **No es una API documentada**: Horos podría
cambiarla sin aviso. En ese caso cada fondo permite escribir el VL a mano, con un enlace a su ficha en horosam.com.
Los planes de pensiones publican el VL con un día más de retraso que los fondos.

## Seguridad

### Qué se protege y cómo
- **Cifrado en reposo:** los datos se guardan en IndexedDB cifrados con AES-GCM de 256 bits usando una *clave de datos* (DK) aleatoria.
- **PIN / contraseña:** la DK se guarda envuelta con una clave derivada del PIN (6 dígitos) o de una contraseña (mínimo 8 caracteres) mediante PBKDF2-SHA256 con 600.000 iteraciones y sal aleatoria. Cambiar el PIN solo vuelve a envolver la DK.
- **Bloqueo:** al abrir la app, al volver tras más de 1 minuto en segundo plano y tras 5 minutos sin uso. Al bloquear, la clave y los datos descifrados se borran de la memoria de la app. Mientras la app está en segundo plano se muestra una pantalla opaca para que los importes no aparezcan en el selector de apps.
- **Intentos fallidos:** a partir del 5.º fallo hay esperas crecientes (de 30 s hasta 15 min).
- **Content-Security-Policy** estricta: solo scripts propios y conexiones únicamente a las APIs de la tabla anterior.
- **Nunca** se piden ni se guardan contraseñas de DEGIRO, Mapfre u Horos. La pantalla de Ledger avisa de que solo hacen falta direcciones públicas o xpub y **nunca las 24 palabras**. Si se pega algo con forma de frase semilla o de clave privada (xprv, WIF, hex de 64 caracteres), se rechaza y se borra del campo.
- **Copias de seguridad:** se exportan en un archivo JSON cifrado con AES-GCM y una contraseña propia de la copia (PBKDF2, 600.000 iteraciones). Nada se sube a ningún sitio.

### Huella / Face ID (WebAuthn) y sus contrapartidas
Se registra una passkey de plataforma (`authenticatorAttachment: 'platform'`, `userVerification: 'required'`). Solo se guardan el **ID de la credencial** y la DK envuelta. Según lo que ofrezca el navegador hay dos modos:

1. **Modo PRF (preferido).** Si el autenticador soporta la extensión WebAuthn **PRF** (Chrome Android con Google Password Manager, iOS/iPadOS 18+ con el llavero de iCloud, etc.), el autenticador devuelve un secreto de 32 bytes que solo se obtiene tras verificar la biometría. De ahí se deriva (HKDF) la clave que envuelve la DK. **La biometría es criptográficamente necesaria** para descifrar: sin el autenticador, esa copia envuelta es inútil.
2. **Modo comodidad (alternativa).** Si PRF no está disponible, la DK se envuelve con una *clave del dispositivo* AES-GCM **no exportable** (`CryptoKey` con `extractable: false`) guardada en IndexedDB, y la biometría actúa solo como **puerta en la interfaz**. Contrapartida: quien pueda ejecutar código en el origen de la app (por ejemplo, con acceso físico a un dispositivo desbloqueado y herramientas de desarrollo, o por malware en el navegador) podría usar esa clave sin pasar por la biometría. Sigue impidiendo leer los datos copiando el almacenamiento a otro equipo, porque la clave no se puede extraer. Ajustes muestra qué modo está activo.

El PIN funciona siempre como alternativa. Desactivar la biometría borra la clave del dispositivo y la DK envuelta.

### Límites del modelo
- Un **PIN de 6 dígitos** solo tiene 10⁶ combinaciones. Frena a quien coja el móvil (con las esperas entre intentos), pero alguien que copie los datos del navegador podría probar todos los PIN fuera de línea. Las esperas se aplican en el cliente, así que no protegen de ese ataque. Para una protección fuerte, usa una **contraseña larga** (opción al crear o en «Cambiar PIN»).
- La app no protege frente a un dispositivo comprometido (malware, extensiones maliciosas, capturas de pantalla).
- Las APIs públicas ven tu IP y las direcciones consultadas (no la xpub). Pueden relacionar esas direcciones entre sí.
- Si borras los datos del navegador o desinstalas la PWA, se pierden los datos: **exporta copias cifradas** de vez en cuando.
- iOS puede borrar el almacenamiento de webs que no se usen en semanas si no están instaladas en la pantalla de inicio: instala la PWA.

## Instalación y despliegue
- Publicada en GitHub Pages. En el móvil: abrir la URL → «Añadir a pantalla de inicio» / «Instalar app».
- Para publicar cambios: **incrementa `CACHE_VERSION` en `sw.js`** y haz push. La app mostrará «Nueva versión disponible».
- Pruebas locales: `python3 -m http.server` y abrir `http://localhost:8000` (WebCrypto exige HTTPS o localhost).

## Estructura
```
index.html  styles.css  manifest.json  sw.js
js/app.js        interfaz, vistas, lógica
js/vault.js      cifrado, PIN, WebAuthn/PRF, copias
js/providers.js  APIs públicas (cripto, precios, Horos)
js/btc.js        derivación xpub→direcciones (secp256k1, RIPEMD-160, bech32/bech32m)
js/degiro.js     lector del CSV de cartera de DEGIRO
icons/           iconos generados localmente
```
