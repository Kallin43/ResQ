import neo4j from 'neo4j-driver';
import AppError from '../utils/AppError.js';

let driverPromise;

export async function connectNeo4j() {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
    throw new Error('Set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD in backend/.env.');
  }
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
  try {
    await driver.verifyConnectivity();
    return driver;
  } catch (error) {
    await driver.close();
    throw new Error(`Neo4j AuraDB connection failed: ${error.message}`);
  }
}

export async function getNeo4jDriver() {
  if (!driverPromise) {
    driverPromise = connectNeo4j().catch((error) => {
      driverPromise = undefined;
      throw new AppError(503, `Neo4j is unavailable: ${error.message}`);
    });
  }
  return driverPromise;
}

export async function closeNeo4j() {
  if (!driverPromise) return;
  const driver = await driverPromise.catch(() => null);
  driverPromise = undefined;
  if (driver) await driver.close();
}

export function neo4jDatabaseName() {
  return process.env.NEO4J_DATABASE || 'neo4j';
}
