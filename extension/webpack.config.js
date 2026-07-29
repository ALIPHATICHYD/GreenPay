const path = require('path');

const entries = {
  'content-script': './src/content-script.ts',
  popup: './src/popup.ts',
};

function createConfig(outputDirectory) {
  return {
    mode: 'production',
    devtool: false,
    entry: entries,
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, outputDirectory),
      clean: true,
    },
  };
}

module.exports = [
  createConfig('dist'),
  createConfig('dist-firefox'),
];
