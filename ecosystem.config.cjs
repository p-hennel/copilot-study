module.exports = {
  apps: [
    {
      name: "crawler",
      interpreter_args: ["--bun", "./build/crawler/main.js"],
      interpreter: "bun",
      //script: "./src/lib/crawler/runner/main.ts",
      //interpreter: "/Users/philhennel/Downloads/copilot-survey/runbun.bash",
      env: {
        PATH: `./:${process.env.PATH}` // Add "~/.bun/bin/bun" to PATH
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
      interpreter_args: ["--bun", "./build/index.js"],
      interpreter: "bun",
      watch: false,
      autorestart: true,
      env: {
        PATH: `/opt/homebrew/bin:${process.env.PATH}` // Add "~/.bun/bin/bun" to PATH
      }
    }
  ]
};
