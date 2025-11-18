import { EntityType, TypeDefinition } from "./types";

export const TILE_SIZE = 40;

export const COLORS = {
    player: '#3b82f6', // Blue
    enemy: '#ef4444',  // Red
    ore: '#22c55e',    // Green
    ground: '#1c1c1c',
    grid: '#2a2a2a',
    selection: '#ffffff',
    path: 'rgba(0, 255, 0, 0.3)'
};

export const DEFINITIONS: Record<EntityType, TypeDefinition> = {
    [EntityType.CONSTRUCTION_YARD]: { name: 'Construction Yard', w: 3, h: 3, hp: 5000, cost: 0, power: 20 },
    [EntityType.POWER_PLANT]: { name: 'Power Plant', w: 2, h: 2, hp: 800, cost: 300, power: 50 },
    [EntityType.REFINERY]: { name: 'Refinery', w: 3, h: 2, hp: 1500, cost: 1500, power: -30 },
    [EntityType.BARRACKS]: { name: 'Barracks', w: 2, h: 2, hp: 1000, cost: 600, power: -10 },
    [EntityType.FACTORY]: { name: 'Factory', w: 3, h: 3, hp: 2000, cost: 2000, power: -40 },
    [EntityType.CANNON]: { name: 'Cannon', w: 1, h: 1, hp: 800, cost: 800, power: -20, range: 250, damage: 40, fireRate: 60 },

    [EntityType.INFANTRY]: { name: 'Rifleman', w: 0.5, h: 0.5, hp: 80, cost: 100, power: 0, speed: 0.3, damage: 5, range: 120, fireRate: 20, radius: 6, buildTime: 2000 },
    [EntityType.TANK]: { name: 'Tank', w: 1, h: 1, hp: 400, cost: 800, power: 0, speed: 0.5, damage: 35, range: 180, fireRate: 90, radius: 16, buildTime: 5000 },
    [EntityType.HARVESTER]: { name: 'Harvester', w: 1, h: 1, hp: 600, cost: 1000, power: 0, speed: 0.4, damage: 0, range: 0, fireRate: 0, radius: 16, buildTime: 4000, capacity: 500 },
    
    [EntityType.ORE]: { name: 'Tiberium', w: 1, h: 1, hp: 100, cost: 0, power: 0 }
};