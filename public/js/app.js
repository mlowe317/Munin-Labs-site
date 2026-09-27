// Munin Labs — client script: navigation, form submission, and inline validation.
(() => {
  'use strict';

  // Mobile navigation
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Footer year
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // Demo form defaults
  const demoForm = document.getElementById('demo-form');
  if (demoForm) {
    const date = demoForm.elements.preferredDate;
    const today = new Date();
    const min = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    date.min = min;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && !demoForm.elements.timezone.value) demoForm.elements.timezone.value = tz;
    } catch (_) {
      /* ignore */
    }

    // "Request an OCR demo" style links pre-select the matching service.
    document.querySelectorAll('[data-service]').forEach((link) => {
      link.addEventListener('click', () => {
        const box = demoForm.querySelector(`input[name="services"][value="${link.dataset.service}"]`);
        if (box) box.checked = true;
      });
    });
  }

  function serialize(form) {
    const data = {};
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (key === 'services') {
        (data.services ||= []).push(value);
      } else {
        data[key] = value;
      }
    }
    return data;
  }

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function showErrors(form, errors) {
    let first = null;
    for (const [field, message] of Object.entries(errors)) {
      const input = form.elements[field];
      const target = input && input.length !== undefined && !input.tagName ? input[0] : input; // RadioNodeList
      const container = target ? target.closest('label, fieldset') : null;
      if (target && target.setAttribute) target.setAttribute('aria-invalid', 'true');
      const note = document.createElement('p');
      note.className = 'field-error';
      note.textContent = message;
      if (container) container.appendChild(note);
      else form.querySelector('.form-status').before(note);
      if (!first && target && target.focus) first = target;
    }
    if (first) first.focus();
  }

  function clientValidate(form) {
    const errors = {};
    for (const el of form.elements) {
      if (!el.name || el.type === 'checkbox' || el.name === 'website') continue;
      if (el.required && !el.value.trim()) errors[el.name] = 'This field is required.';
      else if (el.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value)) {
        errors[el.name] = 'Please enter a valid email.';
      } else if (el.minLength > 0 && el.value.trim().length < el.minLength) {
        errors[el.name] = `Please enter at least ${el.minLength} characters.`;
      }
    }
    if (form.id === 'demo-form' && !form.querySelector('input[name="services"]:checked')) {
      errors.services = 'Select at least one service.';
    }
    return errors;
  }

  function showSuccess(form, title, body) {
    const wrap = document.createElement('div');
    wrap.className = 'form-success';
    wrap.setAttribute('role', 'status');
    wrap.innerHTML = '<div class="tick" aria-hidden="true">✓</div>';
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    wrap.append(h, p);
    form.replaceChildren(wrap);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submit(form, endpoint, successTitle, successBody) {
    clearErrors(form);
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type="submit"]');
    status.className = 'form-status';
    status.textContent = '';

    const localErrors = clientValidate(form);
    if (Object.keys(localErrors).length) {
      showErrors(form, localErrors);
      return;
    }

    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(serialize(form)),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        showSuccess(form, successTitle, successBody);
        return;
      }
      if (body.errors) {
        showErrors(form, body.errors);
        status.className = 'form-status error';
        status.textContent = body.errors.form || 'Please fix the highlighted fields.';
      } else {
        status.className = 'form-status error';
        status.textContent = body.error || 'Something went wrong. Please email lowematthew7@gmail.com.';
      }
    } catch (_) {
      status.className = 'form-status error';
      status.textContent = 'Network error. Please try again or email lowematthew7@gmail.com.';
    } finally {
      button.disabled = false;
      if (status.textContent === 'Sending…') status.textContent = '';
    }
  }

  if (demoForm) {
    demoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(
        demoForm,
        '/api/demo',
        'Demo request received.',
        'Thank you. An engineer will confirm a time by email within one business day and ask about anything we need to tailor the session.',
      );
    });
  }

  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(contactForm, '/api/contact', 'Message sent.', 'Thank you. We reply to every message within one business day.');
    });
  }
})();
