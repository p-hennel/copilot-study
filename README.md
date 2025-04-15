# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

    "build:hasher": "bun run build:hasher:unix64 && bun run build:hasher:win64 && bun run build:hasher:darwinx64 && bun run build:hasher:darwinarm",
    "build:hasher:unix64": "bun build --compile --target=bun-linux-x64-modern ./src/lib/hasher.ts --outfile ./build/hasher-unix-x64",
    "build:hasher:win64": "bun build --compile --target=bun-windows-x64-modern ./src/lib/hasher.ts --outfile ./build/hasher-win-x64",
    "build:hasher:darwinx64": "bun build --compile --target=bun-darwin-x64 ./src/lib/hasher.ts --outfile ./build/hasher-darwin-x64",
    "build:hasher:darwinarm": "bun build --compile --target=bun-darwin-arm64 ./src/lib/hasher.ts --outfile ./build/hasher-darwin-arm64",
