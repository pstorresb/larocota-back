// PM2 process file. Versioned copy: lives inside larocota-back, so paths are
// relative to this repo. The frontend is the sibling checkout ../larocota-front.
// The workspace-root copy (../ecosystem.config.cjs) uses `${__dirname}/larocota-back`
// and `${__dirname}/larocota-front` instead; keep both in sync.
module.exports = {
  apps: [
    {
      name: "larocota-api",
      cwd: __dirname,
      script: "dist/src/server.js",
      interpreter: "node",
      env: { NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_memory_restart: "350M",
    },
    {
      name: "larocota-web",
      cwd: `${__dirname}/../larocota-front`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_memory_restart: "450M",
    },
  ],
};
