import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTOR_CATALOG, connectorCatalogCategories, catalogView } from '../src/main/connector-catalog.js';

test('the bundled catalog ships exactly 100 popular connectors', () => {
  assert.equal(CONNECTOR_CATALOG.length, 100);
  const ids = new Set(CONNECTOR_CATALOG.map((entry) => entry.id));
  assert.equal(ids.size, CONNECTOR_CATALOG.length, 'connector ids must be unique');
  const names = new Set(CONNECTOR_CATALOG.map((entry) => entry.name));
  assert.equal(names.size, CONNECTOR_CATALOG.length, 'connector names must be unique');
});

test('every catalog entry is a valid MCP server definition', () => {
  for (const entry of CONNECTOR_CATALOG) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9_-]{0,63}$/, entry.id);
    assert.match(entry.name, /^[a-zA-Z0-9_-]{1,64}$/, `${entry.id} name ${entry.name}`);
    assert.ok(entry.description.trim().length >= 10, `${entry.id} needs a real description`);
    assert.ok(entry.description.length <= 220, `${entry.id} description is too long`);
    assert.ok(entry.category.trim().length > 0, `${entry.id} needs a category`);
    if (entry.type === 'local') {
      assert.ok(entry.command?.length, `${entry.id} needs a command`);
      assert.ok(entry.command.every((part) => typeof part === 'string' && part.trim().length > 0), `${entry.id} command parts must be non-empty strings`);
      assert.equal(entry.url, undefined, `${entry.id} is local and must not carry a URL`);
    } else {
      assert.match(entry.url ?? '', /^https:\/\/\S+$/, `${entry.id} needs an HTTPS URL`);
      assert.equal(entry.command, undefined, `${entry.id} is remote and must not carry a command`);
    }
  }
});

test('the catalog covers several popular categories', () => {
  const categories = connectorCatalogCategories();
  assert.ok(categories.length >= 6, `expected at least 6 categories, got ${categories.length}`);
  for (const category of categories) {
    assert.ok(CONNECTOR_CATALOG.some((entry) => entry.category === category), `category ${category} has no entries`);
  }
});

test('catalog views flag servers that are already configured', () => {
  const views = catalogView(CONNECTOR_CATALOG.slice(0, 2), new Set([CONNECTOR_CATALOG[0].name]));
  assert.equal(views.length, 2);
  assert.equal(views[0].configured, true);
  assert.equal(views[1].configured, false);
  assert.equal(views[0].id, CONNECTOR_CATALOG[0].id);
  assert.equal(views[0].name, CONNECTOR_CATALOG[0].name);
  assert.equal(views[0].category, CONNECTOR_CATALOG[0].category);
});
