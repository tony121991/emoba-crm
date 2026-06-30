var state = { user: null, capabilityLabels: {}, orders: [], users: [], selectedOrderId: null };
var statusSteps = ['Cargando', 'Cargado en espera de documentos', 'En ruta a destino', 'Entregado'];

function readFiles(input) {
  var files = Array.from(input && input.files ? input.files : []);
  return Promise.all(files.map(function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: reader.result, uploadedAt: new Date().toISOString() }); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }));
}
var q = function (selector) { return document.querySelector(selector); };
var qa = function (selector) { return Array.from(document.querySelectorAll(selector)); };

async function api(path, options) {
  options = options || {};
  options.headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
  var response = await fetch(path, options);
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Error de sistema');
  return data;
}

function has(capability) {
  return state.user && state.user.capabilities && state.user.capabilities.includes(capability);
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function statusClass(status) {
  return normalize(status).replace(/\s+/g, '-');
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value + 'T00:00:00'));
}

function formatDateTime(value) {
  if (!value) return 'Pendiente';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function matches(order, query) {
  return normalize([order.id, order.customer, order.contact, order.product, order.quantity, order.tank1, order.destination, order.loadType, order.details, order.owner].join(' ')).includes(normalize(query));
}

function setMessage(id, text) {
  q(id).textContent = text || '';
}

function setView(viewName) {
  qa('.nav-item').forEach(function (item) { item.classList.toggle('active', item.dataset.view === viewName); });
  qa('.view').forEach(function (view) { view.classList.remove('active'); });
  q('#' + viewName + 'View').classList.add('active');
  q('#pageTitle').textContent = { dashboard: 'Panel interno', client: 'Portal cliente', history: 'Pedidos entregados', users: 'Usuarios y permisos' }[viewName];
}

function applyCapabilities() {
  qa('[data-cap]').forEach(function (element) { element.classList.toggle('hidden', !has(element.dataset.cap)); });
  q('#newOrderShortcut').classList.toggle('hidden', !has('create_orders'));
  q('#userBadge').textContent = state.user.name + ' · ' + state.user.role;
  var firstVisible = qa('.nav-item').find(function (item) { return !item.classList.contains('hidden'); });
  if (firstVisible) setView(firstVisible.dataset.view);
}

function renderMetrics() {
  q('#activeCount').textContent = state.orders.filter(function (order) { return order.status !== 'Entregado'; }).length;
  q('#routeCount').textContent = state.orders.filter(function (order) { return order.status === 'En ruta a destino'; }).length;
  q('#deliveredCount').textContent = state.orders.filter(function (order) { return order.status === 'Entregado'; }).length;
  q('#attentionCount').textContent = state.orders.filter(function (order) { return order.status === 'Cargado en espera de documentos'; }).length;
}

function renderOrdersTable() {
  var query = q('#internalSearch').value;
  var status = q('#statusFilter').value;
  var filtered = state.orders.filter(function (order) { return status === 'all' || order.status === status; }).filter(function (order) { return matches(order, query); });
  q('#ordersTable').innerHTML = filtered.length ? filtered.map(function (order) {
    var encodedId = encodeURIComponent(order.id);
    var actions = has('manage_orders') ? '<button class="row-button" data-open="' + encodedId + '">Editar</button> <button class="row-button danger" data-delete="' + encodedId + '">Eliminar</button>' : '<button class="row-button" data-open="' + encodedId + '">Ver</button>';
    return '<tr><td><strong>' + order.id + '</strong></td><td>' + order.customer + '</td><td>' + order.destination + '</td><td>' + formatDate(order.requestedDate) + '</td><td><span class="status ' + statusClass(order.status) + '">' + order.status + '</span></td><td>' + (order.owner || 'Sin unidad') + '</td><td>' + (order.tank1 || 'Por definir') + '</td><td>' + (order.product || 'Sin producto') + '</td><td class="row-actions">' + actions + '</td></tr>';
  }).join('') : '<tr><td colspan="9"><div class="empty-state">No hay pedidos con esos filtros.</div></td></tr>';
}

function renderHistory() {
  var query = q('#historySearch').value;
  var delivered = state.orders.filter(function (order) { return order.status === 'Entregado'; }).filter(function (order) { return matches(order, query); });
  q('#historyList').innerHTML = delivered.length ? delivered.map(function (order) {
    return '<article class="history-card"><h3>' + order.id + ' · ' + order.customer + '</h3><p>' + order.destination + '</p><p>Producto: ' + order.product + '</p><p>Entregado: ' + formatDateTime(order.deliveredAt) + '</p></article>';
  }).join('') : '<div class="empty-state">Todavía no hay entregas que coincidan.</div>';
}

function renderTracking(order) {
  if (!order) {
    q('#trackingResult').className = 'tracking-result empty';
    q('#trackingResult').textContent = 'No encontramos esa carta porte.';
    return;
  }
  var current = false ? 0 : statusSteps.indexOf(order.status);
  q('#trackingResult').className = 'tracking-result';
  q('#trackingResult').innerHTML = '<strong>' + order.id + ' · ' + order.customer + '</strong><p>Producto: ' + order.product + ' | Cantidad: ' + order.quantity + ' | Destino: ' + order.destination + '</p><p><span class="status ' + statusClass(order.status) + '">' + order.status + '</span></p><div class="timeline">' + statusSteps.map(function (step, index) { return '<div class="timeline-step ' + (index <= current ? 'done' : '') + '">' + step + '</div>'; }).join('') + '</div><p>' + (order.note || 'Sin nota.') + '</p>';
}

function renderCapabilities() {
  q('#capabilityChecks').innerHTML = Object.entries(state.capabilityLabels).map(function (entry) {
    return '<label><input type="checkbox" name="capabilities" value="' + entry[0] + '"> ' + entry[1] + '</label>';
  }).join('');
}

function renderOpsHealth(health) {
  q('#opsHealth').innerHTML = [
    ['Pedidos activos', health.activeOrders],
    ['Entregados', health.delivered],
    ['Usuarios', health.users],
    ['Respaldos', health.backups],
    ['Bitácora', health.auditEntries],
    ['Último respaldo', health.lastBackup || 'Sin respaldo']
  ].map(function (item) { return '<div class="ops-stat"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>'; }).join('');
}

function renderAudit(entries) {
  q('#auditList').innerHTML = entries.length ? entries.map(function (entry) {
    return '<article class="audit-item"><strong>' + entry.action + ' · ' + entry.entityId + '</strong><span>' + new Date(entry.at).toLocaleString('es-MX') + ' · ' + (entry.userName || 'Sistema') + '</span></article>';
  }).join('') : '<div class="empty-state">Sin cambios registrados.</div>';
}

async function loadOps() {
  if (!has('manage_users')) return;
  var health = await api('/api/ops/health');
  renderOpsHealth(health);
  var audit = await api('/api/ops/audit');
  renderAudit(audit.entries);
}

function renderUsers() {
  q('#usersList').innerHTML = state.users.length ? state.users.map(function (user) {
    var caps = user.capabilities.map(function (cap) { return state.capabilityLabels[cap] || cap; }).join(', ');
    var deleteAction = user.active && state.user && user.id !== state.user.id ? '<button class="row-button danger" data-delete-user="' + user.id + '">Eliminar</button>' : '';
    return '<article class="user-card"><div class="user-card-header"><h3>' + user.name + '</h3>' + deleteAction + '</div><p>' + user.email + '</p><p>Rol: ' + user.role + ' · ' + (user.active ? 'Activo' : 'Inactivo') + '</p><p>' + (user.customerName || 'Sin cliente asignado') + '</p><p>' + (caps || 'Sin permisos asignados') + '</p></article>';
  }).join('') : '<div class="empty-state">No hay usuarios.</div>';
}

function renderAll() {
  renderMetrics();
  renderOrdersTable();
  renderHistory();
  if (has('manage_users')) renderUsers();
}

async function loadOrders() {
  var data = await api('/api/orders');
  state.orders = data.orders;
  renderAll();
}

async function loadUsers() {
  if (!has('manage_users')) return;
  var data = await api('/api/users');
  state.users = data.users;
  renderUsers();
}

async function bootstrap() {
  try {
    var me = await api('/api/me');
    state.user = me.user;
    state.capabilityLabels = me.capabilityLabels;
    q('#loginScreen').classList.add('hidden');
    q('#appShell').classList.remove('hidden');
    applyCapabilities();
    renderCapabilities();
    await loadOrders();
    await loadUsers();
  } catch {
    q('#loginScreen').classList.remove('hidden');
    q('#appShell').classList.add('hidden');
  }
}

function renderStatusProgress(status) {
  var current = Math.max(0, statusSteps.indexOf(status));
  return '<div class="status-progress">' + statusSteps.map(function (step, index) {
    return '<span class="progress-step ' + (index <= current ? 'done' : '') + '">' + step + '</span>';
  }).join('') + '</div>';
}

function renderEvidence(order) {
  var evidence = Array.isArray(order.evidence) ? order.evidence : [];
  q('#evidenceList').innerHTML = evidence.length ? evidence.map(function (file, index) {
    var href = file.url || file.data || '#';
    return '<a href="' + href + '" download="' + file.name + '" target="_blank">' + file.name + '</a>';
  }).join('') : '<span class="file-note">Sin evidencias cargadas.</span>';
}

function openOrder(id) {
  var order = state.orders.find(function (item) { return item.id === id; });
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
  if (openButton) { openOrder(decodeURIComponent(openButton.dataset.open)); return; }
  var deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    var id = decodeURIComponent(deleteButton.dataset.delete);
    if (!confirm('¿Eliminar el pedido ' + id + '? Esta acción no se puede deshacer.')) return;
    try {
      await api('/api/orders/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadOrders();
    } catch (error) {
      alert(error.message);
    }
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
