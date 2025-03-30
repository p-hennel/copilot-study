module.exports = {
  apps: [
    {
      name: "web",
      interpreter: "/bin/bash",
      script: "pm2-server.sh",
      watch: false,
      autorestart: false,
      exec_mode: "fork",
      vizion: false,
      env: {
        PATH: `/opt/homebrew/bin/bun:${process.env.PATH}` // Add "~/.bun/bin/bun" to PATH
      }
    }
  ]
};
