import { createOpenAPI, createAllRoutes, readRouterFile } from './index';
import { Command, flags } from '@oclif/command';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as globby from 'globby';
import * as Router from 'koa-router';
import * as YAML from 'js-yaml';

class GenerateOpenapi extends Command {
  static description = 'Generates OpenAPI definitions from your routers';

  static flags = {
    setup: flags.string({ description: 'module to load before loading your routers' }),
    output: flags.string({ required: true, char: 'o' }),
    title: flags.string({ description: 'title of your API - defaults to package.json name' }),
    version: flags.string({
      description: 'version of your API - defaults to package.json version',
    }),
  };

  static strict = false;
  static args = [{ name: 'inputFiles', required: true }];

  async run() {
    const {
      argv,
      flags: { setup, output, ...flags },
    } = this.parse(GenerateOpenapi);

    let { title, version } = flags;

    try {
      if (!title) {
        ({ name: title } = require(path.resolve('./package.json')));
      }

      if (!version) {
        ({ version } = require(path.resolve('./package.json')));
      }
    } catch {
      throw new Error('Could not load title or version from package.json');
    }

    const inputFiles = [];
    for (const inputFileOrFolder of argv) {
      const found = await globby([inputFileOrFolder, '!**.test.js', '!**.d.ts']);

      if (found.length === 0) {
        throw new Error(`Failed to find ${inputFileOrFolder}`);
      }

      inputFiles.push(...found);
    }

    if (setup) {
      this.log(`Running setup: ${setup}`);

      const exported = require(path.resolve(setup));

      if (exported.default) {
        await exported.default();
      }
    }

    const factories = [];
    for (const inputFile of inputFiles) {
      this.log(`Loading ${inputFile}`);

      const factory = await readRouterFile(path.resolve(inputFile));
      factories.push(factory);
    }

    this.log('Loading all routers');
    const routes = await createAllRoutes(factories);

    this.log('Generating OpenAPI spec from routers');
    const openapi = await createOpenAPI(routes, {
      info: {
        title: title || 'Unknown',
        version: version || '0',
      },
    });

    this.log(`Writing to file ${output}`);
    await fs.writeFile(output, JSON.stringify(openapi, null, 2));
  }
}

(async () => {
  try {
    await GenerateOpenapi.run();
    process.exit(0);
  } catch (err) {
    require('@oclif/errors/handle')(err);
  }
})();
