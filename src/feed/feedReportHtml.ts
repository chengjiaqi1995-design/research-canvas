export function applyFeedReportEmbedStyles(doc: Document) {
  doc.documentElement.classList.add('rc-feed-embedded-report');
  if (doc.getElementById('rc-feed-embed-style')) return;

  const style = doc.createElement('style');
  style.id = 'rc-feed-embed-style';
  style.textContent = `
    html.rc-feed-embedded-report,
    html.rc-feed-embedded-report body {
      width: 100% !important;
      min-width: 0 !important;
      overflow-x: auto !important;
    }
    html.rc-feed-embedded-report body {
      margin: 0 !important;
    }
    html.rc-feed-embedded-report body > .page,
    html.rc-feed-embedded-report body > main,
    html.rc-feed-embedded-report body > .container,
    html.rc-feed-embedded-report body > .content,
    html.rc-feed-embedded-report body > .report {
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    html.rc-feed-embedded-report img,
    html.rc-feed-embedded-report svg,
    html.rc-feed-embedded-report canvas,
    html.rc-feed-embedded-report video {
      max-width: 100%;
    }
    html.rc-feed-embedded-report pre,
    html.rc-feed-embedded-report code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    html.rc-feed-embedded-report a[href^="#ref"],
    html.rc-feed-embedded-report [data-ref],
    html.rc-feed-embedded-report .ref-link {
      cursor: pointer;
    }
    html.rc-feed-embedded-report table {
      display: inline-table;
      width: auto !important;
      max-width: none !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

export function transformHtmlReportForFeed(html: string) {
  if (!html || typeof DOMParser === 'undefined') return html;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;

    doc.querySelectorAll('section').forEach((section) => {
      const heading = section.querySelector('h2');
      if (!heading?.textContent?.includes('矛盾信号与待验证点')) return;
      const table = section.querySelector('table');
      if (!table) return;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      if (!rows.length) return;

      const list = doc.createElement('div');
      list.className = 'rc-conflict-list';

      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 3) return;
        const card = doc.createElement('div');
        card.className = 'rc-conflict-item';
        card.innerHTML = `
          <h3>${cells[0].innerHTML}</h3>
          <p><strong>矛盾或风险：</strong>${cells[1].innerHTML}</p>
          <p><strong>下一步验证：</strong>${cells[2].innerHTML}</p>
        `;
        list.appendChild(card);
      });

      if (list.children.length) {
        table.replaceWith(list);
        changed = true;
      }
    });

    applyFeedReportEmbedStyles(doc);

    if (changed) {
      const style = doc.createElement('style');
      style.textContent = `
        .rc-conflict-list { display: grid; gap: 12px; margin-top: 12px; }
        .rc-conflict-item { background: #fff; border: 1px solid #dbe3ee; border-left: 4px solid #b45309; border-radius: 8px; padding: 12px 14px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); }
        .rc-conflict-item h3 { margin: 0 0 6px; font-size: 16px; color: #111827; }
        .rc-conflict-item p { margin: 5px 0; }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return html;
  }
}
