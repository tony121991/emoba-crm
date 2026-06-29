# CRM EMOBA Cloud Ready

Esta carpeta es la version preparada para publicar el CRM en internet usando:

- Hosting Node.js: Render recomendado
- Base de datos: PostgreSQL administrado, Supabase o Neon
- Evidencias: Supabase Storage
- Dominio: crm.energiaenmovimiento.com desde Squarespace

## 1. Crear PostgreSQL

En Supabase o Neon crea una base de datos y copia el DATABASE_URL.
Debe verse parecido a:

postgresql://usuario:password@host:5432/postgres?sslmode=require

## 2. Crear Storage para evidencias

En Supabase Storage crea un bucket privado llamado:

evidencias

Guarda:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_BUCKET=evidencias

## 3. Variables de entorno en Render

Configura:

- NODE_ENV=production
- APP_URL=https://crm.energiaenmovimiento.com
- DATABASE_URL=...
- SESSION_SECRET=un texto largo y aleatorio
- SUPABASE_URL=...
- SUPABASE_SERVICE_ROLE_KEY=...
- SUPABASE_BUCKET=evidencias

## 4. Desplegar app

En Render:

- New Web Service
- Build command: npm install
- Start command: node server.js
- Node version: 22 o superior

Primero prueba la URL temporal de Render.

## 5. Migrar datos actuales

Con DATABASE_URL configurado:

npm run migrate

El script toma los datos desde ../crm-online-mvp/data/db.json por defecto.

## 6. Configurar Squarespace

Cuando Render entregue el destino DNS:

Tipo: CNAME
Host: crm
Destino: el hostname indicado por Render

Despues en Render agrega el dominio:

crm.energiaenmovimiento.com

## 7. Seguridad antes de operar

- Cambiar la contraseña del admin.
- Eliminar o desactivar usuarios demo.
- Revisar permisos por usuario.
- Probar evidencias.
- Probar exportacion CSV.
- Confirmar HTTPS activo.

## Archivos importantes

- server.js: servidor cloud con PostgreSQL y storage
- schema.sql: tablas de base de datos
- .env.example: variables necesarias
- render.yaml: plantilla de despliegue Render
- scripts/migrate-json-to-postgres.js: migracion de datos actuales
