import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNavigationItems, getOwnerRouteRedirect, ownerOnlyRoutes } from './team-navigation';

test('el propietario ve los enlaces administrativos y el especialista solo los módulos compartidos', () => {
  assert.deepEqual(getNavigationItems('owner').map(({ href }) => href), [
    '/dashboard', '/invoices', '/customers', '/catalogs', '/settlements', '/export', '/settings',
  ]);
  assert.deepEqual(getNavigationItems('specialist').map(({ href }) => href), [
    '/dashboard', '/invoices', '/customers', '/settlements',
  ]);
});

test('el enlace móvil de Equipo solo aparece para el propietario', () => {
  assert.ok(getNavigationItems('owner', true).some(({ href }) => href === ownerOnlyRoutes.team));
  assert.ok(!getNavigationItems('specialist', true).some(({ href }) => href === ownerOnlyRoutes.team));
});

test('las rutas administrativas redirigen al especialista y se mantienen protegidas', () => {
  assert.deepEqual(Object.values(ownerOnlyRoutes), ['/catalogs', '/export', '/settings', '/team/members']);
  assert.equal(getOwnerRouteRedirect('specialist'), '/dashboard');
  assert.equal(getOwnerRouteRedirect('owner'), null);
});
