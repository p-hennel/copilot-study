module.exports = {
  apps: [
    {
      name: "crawler",
      interpreter_args: ["--bun"],
      interpreter: "bun",
      script: "./crawler/index.js",
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` // Add "~/.bun/bin/bun" to PATH
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
      interpreter: "/bin/bash",
      script: "pm2-server.sh",
      exec_mode: "cluster",
      instances: "1",
      watch: false,
      autorestart: true,
      env: {
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` // Add "~/.bun/bin/bun" to PATH
      }
    }
  ]
};
