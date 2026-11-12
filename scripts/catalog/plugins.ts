import { backendPlugins } from './plugins-backend.js';
import { dataPlugins } from './plugins-data.js';
import { engineeringPlugins } from './plugins-engineering.js';
import { productPlugins } from './plugins-product.js';
import { workflowPlugins } from './plugins-workflow.js';
import type { PluginSeed } from './types.js';

export const pluginSeeds: PluginSeed[] = [
  ...engineeringPlugins,
  ...backendPlugins,
  ...dataPlugins,
  ...productPlugins,
  ...workflowPlugins,
];
