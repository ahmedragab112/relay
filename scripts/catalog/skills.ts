import { devopsSkills } from './skills-devops.js';
import { engineeringSkills } from './skills-engineering.js';
import { frontendSkills } from './skills-frontend.js';
import { mobileSkills } from './skills-mobile.js';
import { productSkills } from './skills-product.js';
import type { SkillSeed } from './types.js';

export const skillSeeds: SkillSeed[] = [
  ...engineeringSkills,
  ...frontendSkills,
  ...devopsSkills,
  ...productSkills,
  ...mobileSkills,
];
