# TASKS

Aplicación simple para gestionar tareas con:

- fases
- categorías
- tareas con jerarquía local
- dependencias lógicas
- prioridades, notas y responsable opcional
- persistencia local real en JSON
- exportación e importación de respaldos
- interfaz en español e inglés

## Ejecutar

```bash
npm install
npm run dev
```

Disponible en `http://localhost:8080`.

## Estructura

- `src/`: servidor Express, reglas de dominio, persistencia y API
- `public/`: interfaz estática modular
- `data/`: almacenamiento local en ejecución
- `test/`: pruebas del servicio de tareas

## Persistencia

La fuente de verdad es `data/task-map.json`.
Los datos de negocio no usan `localStorage`.
`localStorage` solo guarda preferencias de la interfaz, como filtros, paneles abiertos e idioma.

## Respaldo local

La app permite exportar e importar JSON desde la propia interfaz para respaldar o restaurar su estado local.
No depende de otro proyecto ni se conecta a servicios externos.

## Notas

- No requiere autenticación, base de datos ni integraciones externas.
- La lógica de dependencias impide referencias rotas, ciclos y cambios inválidos de estado.
