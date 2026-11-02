# Poner la app en línea y sincronizada (10 minutos)

Hay dos pasos: **(A)** publicar la página con GitHub Pages para tener una URL, y **(B)** conectar Supabase para que toda la familia vea lo mismo en tiempo real.

---

## A. URL de la app (GitHub Pages)

1. En GitHub abre el repositorio → **Settings** → **Pages**.
2. En *Build and deployment* → *Source* elige **Deploy from a branch**.
3. Branch: **`main`** y carpeta **`/ (root)`** → **Save**.
   *(Mientras el PR no esté fusionado puedes elegir la rama `claude/peaceful-brown-quessi`.)*
4. En 1–2 minutos la app queda en:

   **https://santiagonoriegaardila-beep.github.io/golf-handicap/**

> GitHub Pages en cuentas gratis exige que el repositorio sea **público**. El código es público, pero los **datos no**: viven en Supabase protegidos por el código de familia.

---

## B. Sincronización con Supabase

### 1. Crear el proyecto
1. Entra a <https://supabase.com> → **Start your project** (gratis, con tu cuenta de GitHub o Google).
2. **New project** → nombre `golf-familia`, una contraseña de base de datos (guárdala), región **East US** o la más cercana → **Create**.

### 2. Crear las tablas
1. En el menú izquierdo: **SQL Editor** → **New query**.
2. Copia y pega TODO el archivo [`supabase/schema.sql`](../supabase/schema.sql) → **Run**.
   Debe decir *Success. No rows returned*.

### 3. Copiar URL y llave pública
**Project Settings** → **API** (o **Data API** / **API Keys**):
- **Project URL** → algo como `https://abcdxyz.supabase.co`
- **anon public** key (o **publishable** key, empieza por `sb_publishable_`)

> Nunca uses la llave `service_role` / `secret` en la app.

### 4. Conectar el primer celular
1. Abre la app → **Ajustes** → **☁️ Sincronización**.
2. Pega la URL y la llave, e inventa un **código de familia** (mínimo 8 caracteres, difícil de adivinar, p. ej. `noriega-golf-7Kq2`).
3. **Conectar**. El estado debe pasar a 🟢 **En vivo**. Si este celular ya tenía datos, se suben como punto de partida.

### 5. Invitar a la familia
En **Ajustes** → **🔗 Link de invitación** → mándalo por WhatsApp. Quien lo abra queda conectado automáticamente (el link se guarda en su celular y se borra de la barra de direcciones).

⚠️ **Quien tenga el link puede ver y editar.** Compártelo solo con la familia. Si se filtra, cambien el código de familia: en Ajustes → Desconectar → Conectar con un código nuevo (los datos se suben de nuevo desde ese celular) y manden el link nuevo.

---

## Cómo funciona

| Tema | Detalle |
|---|---|
| Tiempo real | Al guardar, se avisa a los demás celulares por Supabase Realtime (broadcast) y descargan el cambio. Si Realtime falla, cada celular revisa cada 20 s y al volver a la app. |
| Dos personas a la vez | Cada guardado lleva número de versión. Si alguien guardó antes, los cambios se **mezclan** (hoyos y jugadores distintos no se pisan; si dos cambian exactamente el mismo dato, queda el último). |
| Sin señal | Se sigue anotando; el estado dice 🟠 *Sin conexión* y se sube solo cuando vuelve la señal. |
| Hoyo actual | Es de cada celular (navegar no mueve a los demás). |
| Historial | Cada guardado queda en `golf_state_history` (últimas 500 versiones). Para recuperar, ver abajo. |
| Seguridad | La tabla tiene RLS sin políticas: con la llave pública solo se puede usar `golf_get`/`golf_save`, que exigen el código de familia. El código viaja por HTTPS y en la base se guarda solo su hash SHA-256. |

### Recuperar una versión anterior
En Supabase → SQL Editor:
```sql
select public.golf_history('TU-CODIGO', 20);          -- lista versiones
select public.golf_get_version('TU-CODIGO', 123);     -- trae una versión completa
```
Copia el `data` de esa versión a un archivo `.json` y en la app usa *Ajustes → Importar* + *Reemplazar la nube con este celular*.

### Configuración fija (opcional)
`config.js` permite dejar la URL y la llave puestas para todos (son públicas). **No pongas el código de familia ahí**: el repositorio es público.
