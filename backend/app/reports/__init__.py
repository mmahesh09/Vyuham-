"""Report generation: PDF snapshots of dashboards, CSV and Excel exports.

    storage.py  where finished files live (local disk or S3-compatible)
    tabular.py  CSV / XLSX from dashboards, saved queries and datasets
    pdf.py      PDF of a dashboard, rendered by headless Chromium from the print page
    runner.py   runs one ReportRun start to finish
"""
