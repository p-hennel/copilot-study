module.exports = {
  apps: [
    {
      name: "crawler",
      interpreter_args: ["--bun"],
      interpreter: "bun",
      script: "./crawler/index.js",
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
      },
      env_production: {
        NODE_ENV: "production"
      },
      env_development: {
        NODE_ENV: "development"
      },
      instances: "1",
      exec_mode: "cluster"
    },
    {
      name: "web",
      interpreter_args: ["--bun"],
      interpreter: "bun",
      script: "./build/index.js",
      watch: false,
      autorestart: true,
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
      }
    }
  ]
};
