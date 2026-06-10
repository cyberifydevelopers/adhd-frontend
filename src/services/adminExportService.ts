import API from "@/lib/apiClient";

export const adminExportService = {
  downloadDeidentified: async (format: "json" | "csv") => {
    const response = await API.get(`/admin/export/deidentified`, {
      params: { format },
      responseType: format === "csv" ? "blob" : "json",
    });
    if (format === "csv") {
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "deidentified_export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "deidentified_export.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  },
};
