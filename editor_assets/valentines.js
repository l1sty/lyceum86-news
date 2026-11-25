window.initializeValentines = function (requestData, invite) {
  const element = (name) => document.getElementById('val-' + name);
  const form = element('compose');
  const status = element('status');
  const toggle = element('toggle');
  const link = element('link');
  const more = element('more');
  const list = element('letters');
  let code = null;
  let loaded = false;
  let busy = false;
  let cursor = 0;
  let nonce = null;

  function errorText(error) {
    return error instanceof TypeError || error instanceof SyntaxError
      ? 'Немає зв’язку із сервером. Спробуйте ще раз.'
      : error.message;
  }

  function showBox(box) {
    code = box.code;
    link.value = box.link || code || '';
    element('address').hidden = !code;
    element('copy').hidden = !code;
    toggle.textContent = code ? 'Закрити прийом' : 'Відкрити скриньку';
    element('help').textContent = code
      ? 'Надішліть цю адресу друзям. Якщо закрити прийом, вона перестане діяти.'
      : 'Відкрийте скриньку, щоб отримати адресу для друзів.';
    loaded = true;
  }

  async function updateBox(work) {
    if (busy) return;
    busy = true;
    toggle.disabled = more.disabled = element('refresh').disabled = true;
    status.textContent = '';
    try { await work(); }
    catch (error) { status.textContent = errorText(error); }
    finally {
      busy = false;
      toggle.disabled = !loaded;
      more.disabled = element('refresh').disabled = false;
    }
  }

  function refresh(append = false) {
    return updateBox(async () => {
      const box = await requestData('valentines' + (append ? '?before=' + cursor : ''));
      showBox(box);
      if (!append) list.replaceChildren();
      for (const letter of box.items) {
        const card = document.createElement('article');
        card.className = 'post';
        const date = new Date(letter.created * 1000);
        const when = document.createElement('time');
        when.dateTime = date.toISOString();
        when.textContent = date.toLocaleDateString('uk-UA', {day:'numeric', month:'long', year:'numeric'});
        const body = document.createElement('p');
        body.className = 'val-letter';
        body.textContent = letter.text;
        card.append(when, body);
        list.append(card);
        cursor = letter.id;
      }
      if (!list.children.length) list.textContent = 'Валентинок поки немає.';
      more.hidden = !box.more;
    });
  }

  toggle.onclick = () => updateBox(async () => {
    const box = await requestData('valentines/box', {action: code ? 'close' : 'open'});
    showBox(box);
    status.textContent = code ? 'Скриньку відкрито.' : 'Прийом закрито. Отримані валентинки збережено.';
  });
  element('refresh').onclick = () => refresh();
  more.onclick = () => refresh(true);
  element('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      status.textContent = 'Адресу скопійовано.';
    } catch {
      link.focus();
      link.select();
      status.textContent = 'Скопіюйте виділену адресу.';
    }
  };

  if (/^[a-f0-9]{12}$/i.test(invite || '')) form.elements.recipient.value = invite.toUpperCase();
  form.oninput = () => { nonce = null; element('sent').textContent = ''; };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const send = form.querySelector('button');
    if (send.disabled) return;
    const recipient = form.elements.recipient;
    const letter = form.elements.letter;
    const value = recipient.value.trim();
    const match = /^https:\/\/t\.me\/\w+\?start=val_([a-f0-9]{12})$/i.exec(value);
    const target = (match ? match[1] : value).toUpperCase();
    const sent = element('sent');
    if (!/^[A-F0-9]{12}$/.test(target)) {
      sent.textContent = 'Введіть код із 12 символів або посилання на скриньку.';
      recipient.focus();
      return;
    }
    send.disabled = recipient.readOnly = letter.readOnly = true;
    sent.textContent = 'Надсилаємо…';
    try {
      nonce ||= crypto.randomUUID();
      await requestData('valentines/send', {code:target, text:letter.value, nonce});
      nonce = null;
      letter.value = '';
      sent.textContent = 'Валентинку доставлено.';
    } catch (error) { sent.textContent = errorText(error); }
    finally { send.disabled = recipient.readOnly = letter.readOnly = false; }
  };
  return {refresh};
};
