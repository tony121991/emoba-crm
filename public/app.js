  if (!order) return;
  state.selectedOrderId = id;
  q('#dialogTitle').textContent = order.id;
  q('#detailGrid').innerHTML = renderStatusProgress(order.status) + [['Carta Porte', order.id], ['Cliente', order.customer], ['Contacto', order.contact], ['Producto', order.product], ['Cantidad', order.quantity], ['Unidad', order.owner || 'Sin unidad'], ['Tanque 1', order.tank1 || 'Por definir'], ['Destino', order.destination], ['Fecha solicitada', formatDate(order.requestedDate)], ['Servicio', order.loadType], ['Detalles', order.details || 'Sin detalles'], ['Entregado', formatDateTime(order.deliveredAt)]].map(function (item) { return '<div class="detail"><span>' + item[0] + '</span>' + item[1] + '</div>'; }).join('');
  q('#dialogStatus').value = order.status;
  q('#dialogNote').value = order.note || '';
  q('#dialogOwner').value = order.owner || '';
  q('#dialogTank1').value = order.tank1 || '';
  q('#dialogEvidence').value = '';
  renderEvidence(order);
  q('#uploadEvidenceButton').classList.toggle('hidden', !has('manage_orders'));
  q('#saveOrderButton').classList.toggle('hidden', !has('manage_orders'));
  q('#dialogStatus').disabled = !has('manage_orders');
  q('#dialogNote').disabled = !has('manage_orders');
  q('#dialogOwner').disabled = !has('manage_orders');
  q('#dialogTank1').disabled = !has('manage_orders');
  q('#orderDialog').showModal();
}

q('#loginForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  var form = new FormData(event.currentTarget);
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    setMessage('#loginMessage', '');
    await bootstrap();
  } catch (error) {
    setMessage('#loginMessage', error.message);
  }
});

q('#logoutButton').addEventListener('click', async function () {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

qa('.nav-item').forEach(function (item) { item.addEventListener('click', function () { setView(item.dataset.view); }); });
q('#newOrderShortcut').addEventListener('click', function () { setView('client'); });
q('#internalSearch').addEventListener('input', renderOrdersTable);
q('#historySearch').addEventListener('input', renderHistory);
q('#statusFilter').addEventListener('change', renderOrdersTable);
q('#ordersTable').addEventListener('click', async function (event) {
  var openButton = event.target.closest('[data-open]');
  if (openButton) { openOrder(openButton.dataset.open); return; }
  var deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    var id = deleteButton.dataset.delete;
    if (!confirm('¿Eliminar el pedido ' + id + '? Esta acción no se puede deshacer.')) return;
    await api('/api/orders/' + encodeURIComponent(id), { method: 'DELETE' });
    await loadOrders();
  }
});

q('#usersList').addEventListener('click', async function (event) {
  var deleteButton = event.target.closest('[data-delete-user]');
  if (!deleteButton) return;
  var id = deleteButton.dataset.deleteUser;
  var user = state.users.find(function (item) { return item.id === id; });
  if (!user) return;
  if (!confirm('¿Eliminar el usuario ' + user.email + '? Ya no podrá iniciar sesión.')) return;
  try {
    await api('/api/users/' + encodeURIComponent(id), { method: 'DELETE' });
    setMessage('#userMessage', 'Usuario eliminado.');
    await loadUsers();
  } catch (error) {
    setMessage('#userMessage', error.message);
  }
});

q('#orderForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  var form = new FormData(event.currentTarget);
  var payload = Object.fromEntries(form.entries());
  payload.evidence = await readFiles(q('#orderEvidence'));
  try {
    var data = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset();
    q('#orderEvidence').value = '';
    q('#trackingInput').value = data.order.id;
    setMessage('#orderMessage', 'Pedido creado: ' + data.order.id);
    await loadOrders();
    renderTracking(data.order);
  } catch (error) {
    setMessage('#orderMessage', error.message);
  }
});

q('#trackButton').addEventListener('click', function () {
  var id = normalize(q('#trackingInput').value).toUpperCase();
  renderTracking(state.orders.find(function (order) { return order.id.toUpperCase() === id; }));
});

q('#uploadEvidenceButton').addEventListener('click', async function (event) {
  event.preventDefault();
  if (!state.selectedOrderId) return;
  var evidence = await readFiles(q('#dialogEvidence'));
  if (!evidence.length) return;
  await api('/api/orders/' + encodeURIComponent(state.selectedOrderId), { method: 'PATCH', body: JSON.stringify({ evidence: evidence }) });
  q('#dialogEvidence').value = '';
  await loadOrders();
  openOrder(state.selectedOrderId);
});

q('#saveOrderButton').addEventListener('click', async function (event) {
  event.preventDefault();
  if (!state.selectedOrderId) return;
  var payload = { status: q('#dialogStatus').value, note: q('#dialogNote').value, owner: q('#dialogOwner').value, tank1: q('#dialogTank1').value };
  await api('/api/orders/' + encodeURIComponent(state.selectedOrderId), { method: 'PATCH', body: JSON.stringify(payload) });
  q('#orderDialog').close();
  await loadOrders();
});

q('#userForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  var form = new FormData(event.currentTarget);
  var capabilities = Array.from(event.currentTarget.querySelectorAll('input[name="capabilities"]:checked')).map(function (input) { return input.value; });
  var payload = Object.fromEntries(form.entries());
  payload.capabilities = capabilities;
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset();
    setMessage('#userMessage', 'Usuario creado.');
    await loadUsers();
  } catch (error) {
    setMessage('#userMessage', error.message);
  }
});

q('#refreshOpsButton').addEventListener('click', loadOps);
q('#backupButton').addEventListener('click', async function () {
  await api('/api/ops/backup', { method: 'POST' });
  setMessage('#opsMessage', 'Respaldo creado.');
  await loadOps();
});

q('#userForm select[name="role"]').addEventListener('change', function (event) {
  var presets = {
    cliente: ['create_orders', 'track_orders', 'view_history'],
    operador: ['view_dashboard', 'manage_orders', 'view_history'],
    admin: ['view_dashboard', 'create_orders', 'track_orders', 'manage_orders', 'manage_users', 'view_history']
  };
  var caps = presets[event.target.value] || [];
  qa('#capabilityChecks input').forEach(function (input) { input.checked = caps.includes(input.value); });
});

bootstrap();
