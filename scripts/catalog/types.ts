export interface SkillSeed {
  id: string;
  name: string;
  category: string;
  description: string;
  body: string;
}

export interface CommandSeed {
  name: string;
  description: string;
  body: string;
}

export interface PluginSeed {
  id: string;
  name: string;
  description: string;
  commands: CommandSeed[];
}

export const skill = (id: string, name: string, category: string, description: string, body: string): SkillSeed => ({ id, name, category, description, body });

export const command = (name: string, description: string, body: string): CommandSeed => ({ name, description, body });

export const plugin = (id: string, name: string, description: string, commands: CommandSeed[]): PluginSeed => ({ id, name, description, commands });
