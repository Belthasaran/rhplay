# DEPRECATED

The metadata API server has moved to the standalone **RHServer** project.

## New location

```bash
cd ~/rhserver
npm install
npm run setup -- --rhdata-source=../rhplay/electron/rhdata.db --patchbin-source=../rhplay/electron/patchbin.db
npm start
```

See [~/rhserver/docs/MIGRATION_FROM_MDSERVER.md](https://github.com/Belthasaran/rhserver/blob/main/docs/MIGRATION_FROM_MDSERVER.md) (or sibling checkout `../rhserver/docs/MIGRATION_FROM_MDSERVER.md`).

## rhplay npm scripts

- `npm run rhserver:start` — start sibling rhserver
- `npm run rhserver:setup` — run rhserver setup

Legacy `mdserver:*` start/setup scripts print a deprecation message.
