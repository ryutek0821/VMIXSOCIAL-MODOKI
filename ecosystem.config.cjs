module.exports = {
  apps: [
    {
      name: "vmixsocial",
      script: "server.js",
      cwd: __dirname,
      interpreter_args: "--env-file=.env",
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
