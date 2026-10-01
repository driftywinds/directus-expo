module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@": "./",
            "@directus/sdk": "./compat9/shim.ts",
          },
        },
      ],
      "react-native-worklets/plugin"
    ],
  };
};
