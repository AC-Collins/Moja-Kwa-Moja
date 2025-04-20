import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { lazy, Suspense } from "react"; // Explicitly import lazy and Suspense
import mkmLogo from "./assets/mkmlogo.png";

// Dynamically import file processing libraries
const PdfJsLib = lazy(() => import("pdfjs-dist"));
const Mammoth = lazy(() => import("mammoth"));

const MKMATSResumeTransformer = () => {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [plainText, setPlainText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const isMounted = useRef(true);

  // useRef for consistent access to the latest state/props in async callbacks
  const latestPlainText = useRef(plainText);
  useEffect(() => {
    latestPlainText.current = plainText;
  }, [plainText]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // useCallback to memoize the file change handler
  const handleFileChange = useCallback((e) => {
    const selectedFile = e.target.files?.[0];
    const supportedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (isMounted.current && selectedFile) {
      if (supportedTypes.includes(selectedFile.type)) {
        setFile(selectedFile);
        setError("");
        setPlainText("");
      } else {
        setFile(null);
        setError("Please upload a PDF or Word (.doc, .docx) file.");
        setPlainText("");
      }
    }
  }, [isMounted]);

  // useMemo to memoize the bullet normalization function
  const normalizeBullets = useMemo(() => (text) => {
    const bulletRegex = /[\u2022\u2023\u25E6\u2043\u2219\u25CF\u25CB\u25A0*]/g;
    let normalizedText = text.replace(bulletRegex, "*");
    let isListSection = false;
    let isSkillsSection = false;
    const lines = normalizedText.split("\n");
    const result = [];

    const skillPhrases = [
      "Strategic Planning", "Finance Acumen", "Market Research",
      "Data Management & Analysis", "Sales", "Negotiation",
      "Relationship Building", "Networking", "Project Management",
      "Communication"
    ];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.match(/^(Skills|Experience|Licenses & Certifications)$/)) {
        isListSection = line === "Skills"
          ? (isSkillsSection = true)
          : (isListSection = true, isSkillsSection = false);
        result.push(line, "");
        continue;
      } else if (line.match(/^(Education|Honors & Awards|.*Present.*|.*\d{4}$)/)) {
        isListSection = isSkillsSection = false;
        result.push(line);
        continue;
      }
      if (isSkillsSection) {
        const items = line
          .split(/\*\s*|\s*,\s*/)
          .map((item) => item.trim())
          .filter((item) => item && item !== "&");
        if (items.length > 1) {
          const normalizedItems = [];
          let currentSkill = "";
          for (let item of items) {
            currentSkill += (currentSkill ? " " : "") + item;
            if (skillPhrases.some(
              (phrase) => phrase.toLowerCase() === currentSkill.toLowerCase()
            )) {
              normalizedItems.push(currentSkill);
              currentSkill = "";
            } else if (!skillPhrases.some(
              (phrase) => phrase.toLowerCase().startsWith(currentSkill.toLowerCase() + " ")
            )) {
              normalizedItems.push(currentSkill);
              currentSkill = "";
            }
          }
          if (currentSkill) normalizedItems.push(currentSkill);
          result.push(...normalizedItems.map((item) => `* ${item}`));
          continue;
        }
      }
      if (isListSection) {
        if (line.match(/^\s*\*/)) {
          const normalized = line.replace(/^\s*\*\s*/, "* ");
          if (normalized === line) {
            console.log(`Unmatched bullet at line ${i + 1}: ${line}`);
          }
          result.push(normalized);
          continue;
        }
        result.push(line);
        continue;
      }
      result.push(line.replace(/^\s*\*\s*/, ""));
    }
    return result.join("\n");
  }, []); // Empty dependency array means this function is created only once

  // useCallback to memoize the convert handler
  const handleConvert = useCallback(async () => {
    if (!file) return setError("Please select a file to convert.");
    if (!isMounted.current) return;

    setIsProcessing(true);
    setError("");
    let extractedText = "";

    try {
      const reader = new FileReader();
      const readFileAsync = (file) =>
        new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });

      const fileData = await readFileAsync(file);

      if (file.type === "application/pdf") {
        // Load pdfjsLib and set workerSrc dynamically
        const module = await PdfJsLib;
        module.default.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${module.default.version}/pdf.worker.js`;

        const pdfDoc = await module.default.getDocument({ data: fileData }).promise;
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          let lastY = null;
          let pageText = "";
          for (const item of textContent.items) {
            const currentY = item.transform[5];
            if (lastY !== null && Math.abs(currentY - lastY) > 3) {
              pageText += "\n";
            }
            pageText += item.str + " ";
            lastY = currentY;
          }
          extractedText += pageText + "\n\n";
        }
      } else {
        // Load mammoth and extract text
        const module = await Mammoth;
        extractedText = module.default.extractRawText({ arrayBuffer: fileData }).value.replace(
          /^(Education|Experience|Skills|Licenses & Certifications|Honors & Awards)$/gm,
          "$1\n"
        );
      }

      const normalizedText = normalizeBullets(extractedText);
      if (isMounted.current) setPlainText(normalizedText);

    } catch (err) {
      if (isMounted.current) {
        setError("File conversion failed: " + err.message);
        setPlainText("");
      }
    } finally {
      if (isMounted.current) setIsProcessing(false);
    }
  }, [file, isMounted, normalizeBullets]); // Dependencies for handleConvert

  const handleDownload = useCallback(() => {
    if (!latestPlainText.current) return setError("No text has been extracted yet.");
    const blob = new Blob([latestPlainText.current], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "converted_resume.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, []);

  return (
    <div className="bg-gray-100 flex flex-col items-center justify-center w-full min-h-screen py-4 px-4 sm:px-6 lg:px-8 border-2 border-red-500">
      <div className="w-full flex flex-col items-center border-2 border-blue-500">
        <img src={mkmLogo} alt="MKM Logo" className="h-2 mb-1 logo" />
        <p className="text-center text-xs font-semibold text-gray-700 mb-2 slogan">
          Two Resumes. One Sharp Approach.
        </p>
        <h2 className="text-center text-2xl font-bold text-gray-900 mb-2">
          MKM ATS Resume Transformer
        </h2>
        <p className="text-center text-xs text-gray-600 mb-4">
          Upload your PDF or Word document to generate an ATS-compatible resume.
        </p>

        <div className="max-w-lg w-full bg-white rounded-lg shadow-xl p-6 space-y-3">
          <div>
            <label
              htmlFor="file-upload"
              className="block text-sm font-medium text-gray-700 text-center"
            >
              Upload Resume
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleFileChange}
              disabled={isProcessing}
              className="mt-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full mx-auto text-sm border-gray-300 rounded-md"
            />
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-100 border border-red-300 rounded-md p-3 text-center">
              {error}
            </div>
          )}

          <div className="flex justify-center space-x-4">
            <button
              onClick={handleConvert}
              disabled={isProcessing}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {isProcessing ? "Processing..." : "Convert"}
            </button>
            {plainText && (
              <button
                onClick={handleDownload}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Download Text
              </button>
            )}
          </div>

          {plainText && (
            <div className="rounded-md bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900 text-center w-full">
                  Extracted Text Preview
                </h3>
              </div>
              <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
                <pre className="text-left">{plainText}</pre>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-lg w-full mt-6 about-section">
          <h3 className="text-center text-lg font-semibold text-gray-900 mb-2">
            About MKM Sharp Resume
          </h3>
          <p className="text-center text-sm text-gray-600">
            MKM Sharp Resume helps you create ATS-compatible resumes with ease.
            Our tool transforms your PDF or Word documents into plain text,
            ensuring your resume passes through applicant tracking systems
            effectively. With a focus on simplicity and efficiency, we empower
            job seekers to present their best selves.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MKMATSResumeTransformer;