module.exports = {
  apps: [
    {
      name: "crawler",
      interpreter_args: ["--bun"],
      interpreter: "bun",
      script: "/usr/src/app/crawler/main.js",
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
      },
      env_production: {
        NODE_ENV: "production"
      },
      env_development: {
        NODE_ENV: "development"
      },
      instances: "max",
      exec_mode: "cluster"
    },
    {
      name: "web",
      interpreter_args: ["--bun"],
      interpreter: "bun",
      script: "/usr/src/app/index.js",
      watch: false,
      autorestart: true,
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
      }
    }
  ]
};
