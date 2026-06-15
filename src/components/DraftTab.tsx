import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { UserBrandProfile, AppSettings, PostDraft, ScoringResult, CarouselSlide } from '../types';
import { generate } from '../lib/ollama';
import { promptGenerateCarousel } from '../lib/prompts';
// import { cleanupSourceAdaptation, cleanupTopicExpansion } from '../lib/sourceCleanup';

interface Props {
  profile: UserBrandProfile | null;
  settings: AppSettings | null;
}

type PipelineStage = 'idle' | 'main' | 'variants' | 'scoring' | 'selecting' | 'hashtags' | 'done' | 'error';

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http') || src.startsWith('//')) {
      img.crossOrigin = 'Anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
};

const stripEmojis = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\xFF]/g, '')
    .trim();
};

const stripEmojisOnly = (str: string): string => {
  if (!str) return '';
  return str.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
};

const generateTechVectorGraphic = (type: string): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Base Dark Background
  const grad = ctx.createLinearGradient(0, 0, 600, 400);
  grad.addColorStop(0, '#070b16');
  grad.addColorStop(1, '#131e35');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 600, 400);

  // Subtle grid background
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.04)';
  ctx.lineWidth = 1;
  const gridSpacing = 20;
  for (let x = 0; x < 600; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 400);
    ctx.stroke();
  }
  for (let y = 0; y < 400; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(600, y);
    ctx.stroke();
  }

  // Draw Glow Circle in the center
  const glow = ctx.createRadialGradient(300, 200, 50, 300, 200, 250);
  glow.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 600, 400);

  ctx.shadowBlur = 15;

  if (type === 'database') {
    // Lakehouse/Database Topology
    ctx.shadowColor = 'rgba(56, 189, 248, 0.5)'; // cyan glow
    
    // Draw 3 cylinders (Databases/Storage layers)
    const drawCylinder = (cx: number, cy: number, w: number, h: number, label: string) => {
      // Cylinder back gradient
      const cylGrad = ctx.createLinearGradient(cx - w/2, cy, cx + w/2, cy);
      cylGrad.addColorStop(0, '#1e293b');
      cylGrad.addColorStop(1, '#0f172a');
      
      // Draw cylinder body
      ctx.fillStyle = cylGrad;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.ellipse(cx, cy, w/2, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.beginPath();
      ctx.rect(cx - w/2, cy, w, h);
      ctx.fill();
      ctx.stroke();
      
      ctx.beginPath();
      ctx.ellipse(cx, cy + h, w/2, 10, 0, 0, Math.PI);
      ctx.fill();
      ctx.stroke();
      
      // Top cap highlight
      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, w/2, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      ctx.fillText(label, cx, cy + h/2 + 4);
      ctx.shadowBlur = 15;
    };

    // Draw connecting pipelines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(150, 250);
    ctx.lineTo(300, 150);
    ctx.lineTo(450, 250);
    ctx.stroke();

    // Data packets (moving dots)
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(225, 200, 5, 0, Math.PI * 2);
    ctx.arc(375, 200, 5, 0, Math.PI * 2);
    ctx.fill();

    // Draw the cylinders
    drawCylinder(150, 230, 80, 50, 'SOURCE');
    drawCylinder(300, 120, 90, 60, 'LAKEHOUSE');
    drawCylinder(450, 230, 80, 50, 'FABRIC');

  } else if (type === 'circuits') {
    // Futuristic Processor Chip
    ctx.shadowColor = 'rgba(99, 102, 241, 0.5)'; // indigo glow

    // Central Chip
    ctx.fillStyle = '#1e1b4b';
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(220, 120, 160, 160, 12);
    ctx.fill();
    ctx.stroke();

    // Inside core chip design
    ctx.fillStyle = '#312e81';
    ctx.beginPath();
    ctx.roundRect(250, 150, 100, 100, 8);
    ctx.fill();

    // Chip text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText('COMPUTE', 300, 195);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#818cf8';
    ctx.fillText('SPARK / ENGINE', 300, 215);
    ctx.shadowBlur = 15;

    // Outer circuits paths
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    const paths = [
      [[220, 150], [140, 150], [140, 90]],
      [[220, 250], [140, 250], [140, 310]],
      [[380, 150], [460, 150], [460, 90]],
      [[380, 250], [460, 250], [460, 310]],
      [[300, 120], [300, 60]],
      [[300, 280], [300, 340]]
    ];
    paths.forEach(p => {
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) {
        ctx.lineTo(p[i][0], p[i][1]);
      }
      ctx.stroke();
      // Draw end nodes
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      const last = p[p.length - 1];
      ctx.arc(last[0], last[1], 4, 0, Math.PI * 2);
      ctx.fill();
    });

  } else if (type === 'code') {
    // IDE Editor Window
    ctx.shadowColor = 'rgba(16, 185, 129, 0.4)'; // green glow

    // Window wrapper
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(100, 80, 400, 240, 8);
    ctx.fill();
    ctx.stroke();

    // Top Header Bar
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(100, 80, 400, 30, [8, 8, 0, 0]);
    ctx.fill();

    // 3 color window dots
    const colors = ['#ef4444', '#eab308', '#22c55e'];
    colors.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(120 + i * 15, 95, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Window title
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText('spark_job.py', 300, 98);
    ctx.shadowBlur = 15;

    // Syntax-highlighted code mock lines (drawn as rectangles)
    // Left line numbers
    ctx.fillStyle = '#475569';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 1; i <= 8; i++) {
      ctx.fillText(String(i), 125, 130 + i * 20);
    }

    // Code lines: [indent, width, color]
    const lines = [
      [140, 80, '#38bdf8'], // import spark
      [140, 120, '#38bdf8'], 
      [140, 0, '#fff'], // empty
      [140, 150, '#f472b6'], // df = spark.read.load()
      [160, 220, '#a78bfa'], // .filter(df.datacenter == "Fabric")
      [160, 180, '#a78bfa'], // .groupBy("unification")
      [140, 100, '#38bdf8'], // df.show()
      [140, 130, '#34d399']  // print("Pipeline Success!")
    ];

    lines.forEach((line, i) => {
      if (line[1] === 0) return; // skip empty line
      ctx.fillStyle = line[2] as string;
      ctx.beginPath();
      ctx.roundRect(line[0] as number, 123 + i * 20, line[1] as number, 8, 4);
      ctx.fill();
    });

  } else if (type === 'network') {
    // Glowing Neural Net/Mesh
    ctx.shadowColor = 'rgba(168, 85, 247, 0.4)'; // purple glow

    const nodes = [
      [150, 120], [150, 200], [150, 280],
      [300, 100], [300, 200], [300, 300],
      [450, 120], [450, 200], [450, 280]
    ];

    // Draw connecting lines
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      for (let j = 3; j < 6; j++) {
        ctx.beginPath();
        ctx.moveTo(nodes[i][0], nodes[i][1]);
        ctx.lineTo(nodes[j][0], nodes[j][1]);
        ctx.stroke();
      }
    }
    for (let i = 3; i < 6; i++) {
      for (let j = 6; j < 9; j++) {
        ctx.beginPath();
        ctx.moveTo(nodes[i][0], nodes[i][1]);
        ctx.lineTo(nodes[j][0], nodes[j][1]);
        ctx.stroke();
      }
    }

    // Draw nodes
    nodes.forEach((n, idx) => {
      ctx.fillStyle = idx >= 3 && idx <= 5 ? '#a855f7' : '#ec4899';
      ctx.beginPath();
      ctx.arc(n[0], n[1], idx === 4 ? 10 : 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Node pulse outline
      ctx.strokeStyle = idx === 4 ? 'rgba(168, 85, 247, 0.4)' : 'rgba(236, 72, 153, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n[0], n[1], idx === 4 ? 16 : 10, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Central AI Tag
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText('AI AGENT', 300, 203);

  } else if (type === 'charts') {
    // SaaS Analytics Dashboard
    ctx.shadowColor = 'rgba(236, 72, 153, 0.4)'; // pink glow

    // Bar Chart
    const barX = 120;
    const barY = 280;
    const barHeightMax = 120;
    const barValues = [0.4, 0.7, 0.5, 0.95, 0.8];
    const colorsList = ['#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'];

    barValues.forEach((val, i) => {
      const h = val * barHeightMax;
      const x = barX + i * 35;
      const y = barY - h;
      
      ctx.fillStyle = colorsList[i];
      ctx.beginPath();
      ctx.roundRect(x, y, 20, h, [4, 4, 0, 0]);
      ctx.fill();
    });

    // Line Chart overlaying on the right
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(330, 240);
    ctx.lineTo(370, 180);
    ctx.lineTo(410, 210);
    ctx.lineTo(450, 130);
    ctx.lineTo(490, 150);
    ctx.stroke();

    // Data points on line chart
    const points = [[330, 240], [370, 180], [410, 210], [450, 130], [490, 150]];
    points.forEach(p => {
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Axis line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 280);
    ctx.lineTo(500, 280);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText('Q1', 130, 295);
    ctx.fillText('Q2', 200, 295);
    ctx.fillText('Q3', 270, 295);
    ctx.fillText('Q4', 370, 295);
    ctx.fillText('PROJ', 450, 295);

  } else {
    // Default abstract network/workspace connection lines
    ctx.shadowColor = 'rgba(59, 130, 246, 0.4)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      ctx.moveTo(80 + i * 80, 100);
      ctx.lineTo(120 + i * 80, 300);
      ctx.moveTo(100, 80 + i * 50);
      ctx.lineTo(500, 120 + i * 50);
    }
    ctx.stroke();
    
    ctx.fillStyle = '#3b82f6';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(150 + Math.sin(i) * 120, 200 + Math.cos(i) * 80, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Add a clean glassmorphic overlay frame
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 580, 380);

  return canvas.toDataURL('image/jpeg', 0.9);
};

export default function DraftTab({ profile, settings }: Props) {
  const [topic, setTopic] = useState('');
  const [pillar, setPillar] = useState('');
  const [inputMode, setInputMode] = useState<'topic' | 'source'>('topic');
  const [postType, setPostType] = useState<'post' | 'personal' | 'recruiter'>('post');
  
  // Pipeline state
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('idle');
  const [pipelineStatusText, setPipelineStatusText] = useState('');
  const [pipelineError, setPipelineError] = useState('');
  
  // Generated content state
  const [output, setOutput] = useState('');
  const [variants, setVariants] = useState<Array<{ style: string, content: string, score?: ScoringResult }>>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [attachedScore, setAttachedScore] = useState<ScoringResult | undefined>(undefined);
  const [savedDraft, setSavedDraft] = useState<PostDraft | null>(null);
  
  // PDF Carousel / Slides state
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [generatingSlides, setGeneratingSlides] = useState(false);
  
  // Scheduling state
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState(false);
  
  // Publishing state
  const [publishingDirect, setPublishingDirect] = useState(false);
  const [withVideo, setWithVideo] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUploadStatus, setVideoUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [publishSuccess, setPublishSuccess] = useState(false);

  const model = settings?.defaultModel || 'gemma4:latest';
  // const streamingEnabled = settings?.streamingEnabled ?? true; // reserved for future streaming

  // Set default content pillar
  useEffect(() => {
    if (profile && profile.contentPillars && profile.contentPillars.length > 0 && !pillar) {
      setPillar(profile.contentPillars[0]);
    }
  }, [profile, pillar]);

  // Proposes one of the peak days/times (e.g. Wednesday morning at 9:00 AM)
  const handleProposePeakTime = () => {
    const today = new Date();
    const resultDate = new Date();
    
    // Find next Tue (2), Wed (3), or Thu (4)
    const currentDay = today.getDay();
    let daysToAdd = 1;
    
    if (currentDay === 2 || currentDay === 3) {
      daysToAdd = 1; // tomorrow
    } else if (currentDay === 4) {
      daysToAdd = 5; // next Tue
    } else if (currentDay === 5) {
      daysToAdd = 4; // next Tue
    } else if (currentDay === 6) {
      daysToAdd = 3; // next Tue
    } else if (currentDay === 0) {
      daysToAdd = 2; // next Tue
    } else if (currentDay === 1) {
      daysToAdd = 1; // next Tue
    }
    
    resultDate.setDate(today.getDate() + daysToAdd);
    
    // Format YYYY-MM-DD
    const yyyy = resultDate.getFullYear();
    const mm = String(resultDate.getMonth() + 1).padStart(2, '0');
    const dd = String(resultDate.getDate()).padStart(2, '0');
    
    setScheduleDate(`${yyyy}-${mm}-${dd}`);
    setScheduleTime('09:00');
  };

  // Run the full autopilot flow via server API
  const runAutopilot = async () => {
    if (!profile || !topic.trim()) return;

    // Reset UI
    setOutput('');
    setVariants([]);
    setHashtags([]);
    setAttachedScore(undefined);
    setSlides([]);
    setSavedDraft(null);
    setPipelineError('');
    setPipelineStage('main');
    setPipelineStatusText('Generating main draft...');

    try {
      const response = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          pillar,
          model,
          inputMode,
          postType
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Server error running Autopilot.');
      }

      const result = await response.json();
      const draft = result.selectedDraft;

      // Update UI with result (filter out any emojis)
      setOutput(stripEmojisOnly(draft.content));
      setHashtags(draft.hashtags || []);
      setAttachedScore(draft.scoringResult);
      setSavedDraft(draft);
      
      // Setup variants (filter out any emojis)
      const mappedVariants = result.allCandidates
        .filter((c: any) => c.label !== 'Main draft')
        .map((c: any) => ({
          style: c.label,
          content: stripEmojisOnly(c.content),
          score: c.score
        }));
      setVariants(mappedVariants);

      setPipelineStage('done');
      setPipelineStatusText(`Success! Selected draft: Score ${draft.scoringResult.totalScore}/10. Saved as draft.`);
    } catch (err: any) {
      console.error(err);
      setPipelineStage('error');
      setPipelineError(err.message);
    }
  };

  // Generate a structured PDF Slide layout
  const generateSlidesLayout = async () => {
    if (!output.trim()) return;
    setGeneratingSlides(true);
    setSlides([]);

    try {
      const { system, user } = promptGenerateCarousel(output);
      const response = await generate(user, system, model, undefined, { temperature: 0.3 });
      
      const cleanedJson = response.replace(/```json|```/gi, '').trim();
      const parsedSlides = JSON.parse(cleanedJson) as CarouselSlide[];
      
      // Auto-assign vector graphics with rotating distribution to ensure variety (no duplicates)
      const slidesWithGraphics = parsedSlides.map((slide, idx) => {
        const types = ['database', 'circuits', 'code', 'network', 'charts'];
        const type = types[idx % types.length];
        
        const base64 = generateTechVectorGraphic(type);
        return {
          ...slide,
          image: base64
        };
      });
      
      setSlides(slidesWithGraphics);
      
      // Update draft in database
      if (savedDraft) {
        const updatedDraft = { ...savedDraft, carouselSlides: slidesWithGraphics };
        await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedDraft)
        });
        setSavedDraft(updatedDraft);
      }
    } catch (err) {
      console.error('Failed to generate slides:', err);
      alert('Error creating slide layouts. Model might have returned invalid JSON. Please try again.');
    } finally {
      setGeneratingSlides(false);
    }
  };

  // Update a slide's image property and save it in the database
  const updateSlideImage = (slideNumber: number, base64Image: string | undefined) => {
    const updatedSlides = slides.map(s => {
      if (s.slideNumber === slideNumber) {
        return { ...s, image: base64Image };
      }
      return s;
    });
    setSlides(updatedSlides);

    if (savedDraft) {
      const updatedDraft = { ...savedDraft, carouselSlides: updatedSlides };
      fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDraft)
      });
      setSavedDraft(updatedDraft);
    }
  };

  // Handle local image file upload for a slide
  const handleSlideImageUpload = (slideNumber: number, file: File) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Image is too large. Please upload an image under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      updateSlideImage(slideNumber, base64data);
    };
    reader.readAsDataURL(file);
  };

  // Fetch preset photo URL and save as base64 in slide using HTML5 Canvas to bypass CORS fetch issues
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _applyImagePreset = (slideNumber: number, imageUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const base64data = canvas.toDataURL('image/jpeg', 0.85);
          updateSlideImage(slideNumber, base64data);
        }
      } catch (err) {
        console.error('Failed to convert preset image to canvas base64:', err);
        alert('Could not process this preset photo. Please try uploading a custom image instead.');
      }
    };
    img.onerror = (err) => {
      console.error('Failed to load image from CDN:', err);
      alert('Could not load preset photo. Please verify your internet connection or upload a custom photo.');
    };
    img.src = imageUrl;
  };

  // Automatically extract keyword from slide content and generate a related local tech vector diagram
  const applyAutoSearchImage = (slide: CarouselSlide) => {
    // Rotating distribution based on slide position to guarantee visual variety across the deck
    const types = ['database', 'circuits', 'code', 'network', 'charts'];
    const type = types[(slide.slideNumber - 1) % types.length];
    
    const base64 = generateTechVectorGraphic(type);
    updateSlideImage(slide.slideNumber, base64);
  };

  // Download the slides as a premium PDF layout
  const downloadCarouselPDF = async () => {
    if (slides.length === 0) return;

    // Create a portrait PDF: 540 x 675 pt (4:5 ratio, equivalent to 1080x1350 px)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [540, 675]
    });

    for (let index = 0; index < slides.length; index++) {
      const slide = slides[index];
      if (index > 0) {
        doc.addPage([540, 675], 'portrait');
      }

      // 1. Dark Theme Background Fill (Clean tech blue-black)
      doc.setFillColor(8, 13, 26); // #080d1a
      doc.rect(0, 0, 540, 675, 'F');

      // 2. Determine slide parameters
      const isTitleSlide = slide.isTitleSlide || (slide.slideNumber === 1);
      const category = stripEmojis((slide.category ?? (isTitleSlide ? 'STRATEGIC ARCHITECTURAL ASSESSMENT' : (pillar || 'DATA STRATEGY'))));
      const title = stripEmojis(slide.title);
      const cleanContent = stripEmojis(slide.content ?? '');

      if (isTitleSlide) {
        // --- TITLE SLIDE LAYOUT ---
        doc.setTextColor(56, 189, 248); // Cyan category
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(category.toUpperCase(), 270, 240, { align: 'center' });

        doc.setTextColor(255, 255, 255); // White main title
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(30);
        const titleLines = doc.splitTextToSize(title, 460);
        doc.text(titleLines, 270, 280, { align: 'center', lineHeightFactor: 1.25 });

        const titleHeight = titleLines.length * 36;

        const cleanSubtitle = slide.subtitle ? stripEmojis(slide.subtitle) : cleanContent;
        if (cleanSubtitle) {
          doc.setTextColor(148, 163, 184); // Slate-400 subtitle
          doc.setFont('Helvetica', 'normal');
          doc.setFontSize(14);
          const subLines = doc.splitTextToSize(cleanSubtitle, 420);
          doc.text(subLines, 270, 280 + titleHeight + 15, { align: 'center', lineHeightFactor: 1.35 });
        }
      } else {
        // --- CONTENT SLIDE LAYOUT ---
        // Category Label with Left Accent Bar
        doc.setFillColor(59, 130, 246); // Blue
        doc.rect(40, 60, 4, 18, 'F');

        doc.setTextColor(59, 130, 246); // Blue category text
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(category.toUpperCase(), 55, 73);

        // Slide Title
        doc.setTextColor(255, 255, 255);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(20);
        const titleLines = doc.splitTextToSize(title, 460);
        doc.text(titleLines, 40, 115, { lineHeightFactor: 1.25 });

        const titleHeight = titleLines.length * 25;
        const bodyY = 115 + titleHeight + 10;

        // Split column layout check
        const hasImage = !!slide.image;
        const textWidth = hasImage ? 230 : 460;

        // Slide description content paragraph
        doc.setTextColor(226, 232, 240); // slate-200
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(13);
        const bodyLines = doc.splitTextToSize(cleanContent, textWidth);
        doc.text(bodyLines, 40, bodyY, { lineHeightFactor: 1.4 });

        const bodyHeight = bodyLines.length * 18;
        let listY = bodyY + bodyHeight + 20;

        // Render bullet list items
        if (slide.bullets && slide.bullets.length > 0) {
          slide.bullets.forEach((bullet) => {
            if (listY > 580) return; // prevent overflow
            
            const bulletTitle = stripEmojis(bullet.label || "");
            const bulletText = stripEmojis(bullet.text || "");

            // Solid blue bullet circle
            doc.setFillColor(56, 189, 248);
            doc.circle(45, listY + 5, 3, 'F');

            // Bullet title
            doc.setTextColor(255, 255, 255);
            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(12);
            doc.text(bulletTitle, 55, listY + 8);

            // Bullet description
            doc.setTextColor(148, 163, 184);
            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(11);
            const bulletTextLines = doc.splitTextToSize(bulletText, textWidth - 20);
            doc.text(bulletTextLines, 55, listY + 22, { lineHeightFactor: 1.35 });

            listY += 25 + bulletTextLines.length * 15;
          });
        }

        // Draw image on the right column if present
        if (hasImage && slide.image) {
          try {
            const imgElement = await loadImage(slide.image);
            const formatMatch = slide.image.match(/^data:image\/(\w+);base64,/);
            const imgFormat = (formatMatch && formatMatch[1] ? formatMatch[1].toUpperCase() : 'JPEG');
            
            // Draw a subtle border around the right-hand image
            doc.setDrawColor(30, 41, 59); // slate-800 border
            doc.setLineWidth(1);
            doc.rect(295, 140, 205, 154);
            
            doc.addImage(imgElement, imgFormat, 296, 141, 203, 152, undefined, 'FAST');
          } catch (err) {
            console.error('Failed to draw right-column slide image in PDF:', err);
          }
        }
      }

      // 5. Elegant Footer Divider
      doc.setDrawColor(31, 41, 55); // #1f2937 (slate-800)
      doc.setLineWidth(1.5);
      doc.line(40, 610, 500, 610);

      // 6. Slide Index Indicator
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`${slide.slideNumber} / ${slides.length}`, 40, 635);

      // 7. Right-aligned clickable footer branding links (CORS & PDF readers safe)
      if (profile) {
        let currentX = 500;
        
        // 7a. GitHub Link
        if (profile.githubUrl) {
          const cleanGh = profile.githubUrl.replace(/https?:\/\/(www\.)?/, '').replace(/\/$/, '');
          const label = cleanGh;
          const url = profile.githubUrl.startsWith('http') ? profile.githubUrl : `https://${profile.githubUrl}`;
          
          doc.setTextColor(56, 189, 248); // Cyan (#38bdf8) for clickables
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(11);
          
          const textWidth = doc.getTextWidth(label);
          currentX -= textWidth;
          
          doc.textWithLink(label, currentX, 635, { url });
          
          // Separator if we also have LinkedIn
          if (profile.linkedinUrl) {
            doc.setTextColor(148, 163, 184);
            doc.setFont('Helvetica', 'normal');
            const sepWidth = doc.getTextWidth('   |   ');
            currentX -= sepWidth;
            doc.text('   |   ', currentX, 635);
          }
        }
        
        // 7b. LinkedIn Link
        if (profile.linkedinUrl) {
          const cleanLi = profile.linkedinUrl.replace(/https?:\/\/(www\.)?/, '').replace(/\/$/, '');
          const label = cleanLi;
          const url = profile.linkedinUrl.startsWith('http') ? profile.linkedinUrl : `https://${profile.linkedinUrl}`;
          
          doc.setTextColor(56, 189, 248); // Cyan
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(11);
          
          const textWidth = doc.getTextWidth(label);
          currentX -= textWidth;
          
          doc.textWithLink(label, currentX, 635, { url });
        }
        
        // 7c. Fallback text if no links set
        if (!profile.linkedinUrl && !profile.githubUrl) {
          const label = profile.name || 'Personal';
          doc.setTextColor(243, 244, 246);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(11);
          const textWidth = doc.getTextWidth(label);
          doc.text(label, 500 - textWidth, 635);
        }
      } else {
        const label = 'Personal';
        doc.setTextColor(243, 244, 246);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(11);
        const textWidth = doc.getTextWidth(label);
        doc.text(label, 500 - textWidth, 635);
      }
    }

    doc.save(`linkedin_carousel_${Date.now()}.pdf`);
  };

  // Copy all slides text to clipboard
  const copySlidesText = async () => {
    if (slides.length === 0) return;
    const text = slides.map(s => {
      const titleStr = s.title ? `${s.title}\n` : '';
      return `[Slide ${s.slideNumber}]\n${titleStr}${s.content}`;
    }).join('\n\n');

    await navigator.clipboard.writeText(text);
    alert('All slide texts copied to clipboard!');
  };

  // Copy single slide content
  const copySingleSlide = async (slide: CarouselSlide) => {
    const text = (slide.title ? `${slide.title}\n` : '') + slide.content;
    await navigator.clipboard.writeText(text);
    alert(`Slide ${slide.slideNumber} text copied to clipboard!`);
  };

  // Schedule the post
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savedDraft || !scheduleDate || !scheduleTime) return;
    setScheduling(true);
    setScheduleSuccess(false);

    // If video is attached, upload it now and save the URN to the draft
    let resolvedVideoUrn: string | undefined = savedDraft.videoUrn;
    if (withVideo && videoFile && !resolvedVideoUrn) {
      try {
        setVideoUploadStatus('uploading');
        const initRes = await fetch('/api/linkedin/init-video-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileSize: videoFile.size })
        });
        const initData = await initRes.json();
        if (!initRes.ok) throw new Error(initData.error || 'Video init failed');

        const uploadedPartIds: string[] = [];
        for (const instruction of initData.uploadInstructions) {
          const chunk = videoFile.slice(instruction.firstByte, instruction.lastByte + 1);
          const chunkRes = await fetch(
            `/api/linkedin/proxy-video-upload-chunk?uploadUrl=${encodeURIComponent(instruction.uploadUrl)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }
          );
          const chunkData = await chunkRes.json();
          if (!chunkRes.ok) throw new Error(chunkData.error || 'Chunk upload failed');
          uploadedPartIds.push(chunkData.ETag);
        }

        const finalRes = await fetch('/api/linkedin/finalize-video-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrn: initData.videoUrn, uploadToken: initData.uploadToken, uploadedPartIds })
        });
        const finalData = await finalRes.json();
        if (!finalRes.ok) throw new Error(finalData.error || 'Video finalize failed');

        resolvedVideoUrn = finalData.videoUrn;
        setVideoUploadStatus('done');
      } catch (err: any) {
        setVideoUploadStatus('error');
        alert(`Video upload failed: ${err.message}\nPost will be scheduled without video.`);
      }
    }

    // Combine date/time
    const epoch = new Date(`${scheduleDate}T${scheduleTime}`).getTime();

    const updatedDraft: PostDraft = {
      ...savedDraft,
      status: 'ready',
      scheduledAt: epoch,
      videoUrn: resolvedVideoUrn,
      updatedAt: Date.now()
    };

    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDraft)
      });

      if (!response.ok) throw new Error('Failed to schedule draft');

      const data = await response.json();
      setSavedDraft(data);
      setScheduleSuccess(true);
      setTimeout(() => setScheduleSuccess(false), 4000);
    } catch (err) {
      console.error(err);
      alert('Error scheduling post');
    } finally {
      setScheduling(false);
    }
  };

  // Publish to LinkedIn directly now
  const handlePublishDirect = async () => {
    if (!output.trim()) return;
    setPublishingDirect(true);
    setPublishSuccess(false);

    try {
      // If video toggle is on, upload video via sequential chunk architecture
      let videoUrn: string | undefined;
      if (withVideo && videoFile) {
        setVideoUploadStatus('uploading');
        const initRes = await fetch('/api/linkedin/init-video-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileSize: videoFile.size })
        });
        const initData = await initRes.json();
        if (!initRes.ok) throw new Error(initData.error || 'Video init failed');

        const uploadedPartIds: string[] = [];
        for (const instruction of initData.uploadInstructions) {
          const chunk = videoFile.slice(instruction.firstByte, instruction.lastByte + 1);
          const chunkRes = await fetch(
            `/api/linkedin/proxy-video-upload-chunk?uploadUrl=${encodeURIComponent(instruction.uploadUrl)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }
          );
          const chunkData = await chunkRes.json();
          if (!chunkRes.ok) throw new Error(chunkData.error || 'Chunk upload failed');
          uploadedPartIds.push(chunkData.ETag);
        }

        const finalRes = await fetch('/api/linkedin/finalize-video-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrn: initData.videoUrn,
            uploadToken: initData.uploadToken,
            uploadedPartIds
          })
        });
        const finalData = await finalRes.json();
        if (!finalRes.ok) throw new Error(finalData.error || 'Video finalize failed');

        videoUrn = finalData.videoUrn;
        setVideoUploadStatus('done');
      }

      const response = await fetch('/api/linkedin/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: output, videoUrn })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'LinkedIn API error');
      }

      setPublishSuccess(true);
      
      // Update draft status in local DB
      if (savedDraft) {
        const updatedDraft: PostDraft = {
          ...savedDraft,
          status: 'posted',
          postedAt: Date.now(),
          linkedinPostId: data.postId,
          updatedAt: Date.now()
        };
        
        await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedDraft)
        });

        // Automatically log analytics
        const logData = {
          sourceDraftId: updatedDraft.id,
          postTitle: topic.slice(0, 40) + '...',
          postedAt: Date.now(),
          pillar: pillar,
          format: slides.length > 0 ? 'data' : 'insight',
          impressions: 0,
          reactions: 0,
          comments: 0,
          reposts: 0,
          profileViews: 0,
          notes: `Published via API URN: ${data.postId}`
        };

        await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(logData)
        });

        setSavedDraft(updatedDraft);
      }
      
      setTimeout(() => setPublishSuccess(false), 5000);
    } catch (err: any) {
      console.error(err);
      alert(`Publishing failed: ${err.message}`);
    } finally {
      setPublishingDirect(false);
    }
  };

  // Manual publishing flow: Copy text and redirect to LinkedIn feed
  const handlePublishManual = async () => {
    if (!output.trim()) return;
    
    // Copy content to clipboard
    await navigator.clipboard.writeText(output);

    // Save as posted in DB
    if (savedDraft) {
      const updatedDraft: PostDraft = {
        ...savedDraft,
        status: 'posted',
        postedAt: Date.now(),
        linkedinPostId: `manual-urn-${Date.now()}`,
        updatedAt: Date.now()
      };

      await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDraft)
      });

      // Automatically seed analytics log
      const logData = {
        sourceDraftId: updatedDraft.id,
        postTitle: topic.slice(0, 40) + '...',
        postedAt: Date.now(),
        pillar: pillar,
        format: slides.length > 0 ? 'data' : 'insight',
        impressions: 0,
        reactions: 0,
        comments: 0,
        reposts: 0,
        profileViews: 0,
        notes: `Published manually. Text copied.`
      };

      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      });

      setSavedDraft(updatedDraft);
    }

    alert('Post content copied to clipboard! Opening LinkedIn feed in a new window so you can paste and upload slides.');
    window.open('https://www.linkedin.com/feed/', '_blank');
  };

  const isAutopilotRunning = pipelineStage !== 'idle' && pipelineStage !== 'done' && pipelineStage !== 'error';
  const hasSettingsConfigured = !!settings?.linkedinAccessToken;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {!profile && (
        <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.25)', color: '#f59e0b', padding: '1rem', borderRadius: '12px', fontSize: '0.9rem' }}>
          ⚠️ Please set up your **Brand Profile** first before generating posts.
        </div>
      )}

      {/* Generation Panel */}
      <div className="card-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '700' }}>Post Generator</h2>
          
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className={`btn btn-outline`} 
              onClick={() => setPostType('post')}
              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: postType === 'post' ? 'rgba(255,255,255,0.08)' : 'none' }}
            >
              📝 Organic Post
            </button>
            <button 
              className={`btn btn-outline`} 
              onClick={() => setPostType('personal')}
              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: postType === 'personal' ? 'rgba(255,255,255,0.08)' : 'none' }}
            >
              Personal Story
            </button>
            <button 
              className={`btn btn-outline`} 
              onClick={() => setPostType('recruiter')}
              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: postType === 'recruiter' ? 'rgba(255,255,255,0.08)' : 'none' }}
            >
              🎯 Recruiter Showcase
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Input Mode</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                type="button" 
                onClick={() => setInputMode('topic')} 
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', background: inputMode === 'topic' ? '#0a66c2' : 'transparent', color: '#fff', cursor: 'pointer' }}
              >
                💡 Topic Idea
              </button>
              <button 
                type="button" 
                onClick={() => setInputMode('source')} 
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', borderRadius: '20px', border: '1px solid var(--border-color)', background: inputMode === 'source' ? '#0a66c2' : 'transparent', color: '#fff', cursor: 'pointer' }}
              >
                📄 Adapt Source Material
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              {inputMode === 'topic' ? 'What do you want to post about?' : 'Paste your source text or raw ideas:'}
            </label>
            <textarea
              className="form-textarea"
              placeholder={inputMode === 'topic' ? 'e.g. Why local Ollama models are a game-changer for data privacy...' : 'Paste draft notes, links, or developer thoughts...'}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              rows={4}
              disabled={isAutopilotRunning}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {postType !== 'personal' && (
              <div className="form-group">
                <label className="form-label">Content Pillar</label>
                <select className="form-select" value={pillar} onChange={e => setPillar(e.target.value)} disabled={isAutopilotRunning}>
                  {(profile?.contentPillars || []).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Active LLM Model</label>
              <input type="text" className="form-input" value={model} disabled style={{ opacity: 0.6 }} />
            </div>
          </div>

          <button 
            type="button" 
            className="btn btn-accent" 
            onClick={runAutopilot} 
            disabled={!profile || !topic.trim() || isAutopilotRunning}
            style={{ padding: '1.1rem', fontSize: '1rem' }}
          >
            {isAutopilotRunning ? '⚡ Running Autopilot Pipeline...' : '⚡ Run Autopilot (Generate, Tag & Save)'}
          </button>
        </div>
      </div>

      {/* Autopilot Progress Visualizer */}
      {pipelineStage !== 'idle' && (
        <div className="card-panel pipeline-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>Autopilot Status</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {pipelineStage === 'done' ? 'Completed' : pipelineStage === 'error' ? 'Failed' : 'Running...'}
            </span>
          </div>

          <p style={{ fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            {pipelineStatusText}
          </p>

          <div className="pipeline-stepper">
            <div className={`pipeline-step ${(['main','variants','scoring','selecting','hashtags','done','error'] as string[]).includes(pipelineStage) ? 'completed' : 'pending'}`}>
              <span>1. Generate Main Draft Outline</span>
              <span>{['main', 'variants', 'scoring', 'selecting', 'hashtags', 'done'].includes(pipelineStage) ? '✓ Done' : 'Running...'}</span>
            </div>
            <div className={`pipeline-step ${['variants', 'scoring', 'selecting', 'hashtags', 'done'].includes(pipelineStage) ? 'completed' : pipelineStage === 'main' ? 'active' : 'pending'}`}>
              <span>2. Generate Style Variants</span>
              <span>{['scoring', 'selecting', 'hashtags', 'done'].includes(pipelineStage) ? '✓ Done' : pipelineStage === 'variants' ? 'Running...' : 'Pending'}</span>
            </div>
            <div className={`pipeline-step ${['selecting', 'hashtags', 'done'].includes(pipelineStage) ? 'completed' : pipelineStage === 'scoring' ? 'active' : 'pending'}`}>
              <span>3. Evaluate & Score Candidates</span>
              <span>{['selecting', 'hashtags', 'done'].includes(pipelineStage) ? '✓ Done' : pipelineStage === 'scoring' ? 'Running...' : 'Pending'}</span>
            </div>
            <div className={`pipeline-step ${['hashtags', 'done'].includes(pipelineStage) ? 'completed' : pipelineStage === 'selecting' ? 'active' : 'pending'}`}>
              <span>4. Pick Winner and Suggest Hashtags</span>
              <span>{pipelineStage === 'done' ? '✓ Done' : pipelineStage === 'hashtags' || pipelineStage === 'selecting' ? 'Running...' : 'Pending'}</span>
            </div>
          </div>

          {pipelineError && (
            <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', marginTop: '1rem', fontSize: '0.85rem' }}>
              Error: {pipelineError}
            </div>
          )}
        </div>
      )}

      {/* Post Editor Output */}
      {output && (
        <div className="card-panel" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '1rem' }}>Autopilot Winner Draft</h3>
            <textarea
              className="form-textarea"
              value={output}
              onChange={e => setOutput(e.target.value)}
              style={{ minHeight: '350px', lineHeight: '1.6', fontSize: '0.95rem' }}
            />

            {hashtags.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Suggested Tags:</h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {hashtags.map(t => (
                    <span key={t} className="chip chip-primary">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Publishing & Scheduling Dashboard */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '2rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.5rem' }}>Autopilot Score</h3>
              {attachedScore ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1rem', borderRadius: '12px' }}>
                  <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#10b981' }}>{attachedScore.totalScore.toFixed(1)}/10</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                    <strong>Feedback:</strong>
                    <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem' }}>
                      {attachedScore.feedback.slice(0, 3).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div style={{ fontStyle: 'italic', fontSize: '0.9rem', color: 'var(--text-muted)' }}>No score attached.</div>
              )}
            </div>

            {/* Direct Post Button */}
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>Publishing Options</h3>

              {/* Video Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={withVideo}
                    onChange={e => { setWithVideo(e.target.checked); setVideoFile(null); setVideoUploadStatus('idle'); }}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  Post with video
                </label>
                {withVideo && (
                  <div style={{ flex: 1 }}>
                    <input
                      type="file"
                      accept="video/mp4,video/mov,video/avi,video/quicktime"
                      onChange={e => { setVideoFile(e.target.files?.[0] || null); setVideoUploadStatus('idle'); }}
                      style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', width: '100%' }}
                    />
                    {videoFile && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                        {videoUploadStatus === 'uploading' && <span style={{ color: '#f59e0b', marginLeft: '8px' }}>Uploading to LinkedIn...</span>}
                        {videoUploadStatus === 'done' && <span style={{ color: '#10b981', marginLeft: '8px' }}>Uploaded!</span>}
                        {videoUploadStatus === 'error' && <span style={{ color: '#ef4444', marginLeft: '8px' }}>Upload failed</span>}
                      </div>
                    )}
                    {withVideo && !videoFile && (
                      <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '4px' }}>Select a video file to attach</div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {hasSettingsConfigured ? (
                  <button 
                    className="btn btn-primary" 
                    onClick={handlePublishDirect}
                    disabled={publishingDirect || (withVideo && !videoFile)}
                  >
                    {publishingDirect ? 'Publishing...' : '🚀 Publish directly to LinkedIn'}
                  </button>
                ) : (
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.85rem', borderRadius: '8px', border: '1px dashed var(--border-color)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    💡 API Integration not configured. Authenticate in **Settings** to enable direct posting.
                  </div>
                )}
                
                <button className="btn btn-outline" onClick={handlePublishManual}>
                  📋 Copy Text & Post Manually
                </button>
                
                {publishSuccess && (
                  <div style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: '600', textAlign: 'center' }}>
                    ✓ Published successfully! Analytics seeded.
                  </div>
                )}
              </div>
            </div>

            {/* Scheduler */}
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem' }}>Queue & Auto-Schedule</h3>
              <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <input 
                    type="date" 
                    className="form-input" 
                    value={scheduleDate} 
                    onChange={e => setScheduleDate(e.target.value)}
                    required
                  />
                  <input 
                    type="time" 
                    className="form-input" 
                    value={scheduleTime} 
                    onChange={e => setScheduleTime(e.target.value)}
                    required
                  />
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-outline" onClick={handleProposePeakTime} style={{ padding: '0.5rem', fontSize: '0.8rem', flex: 1 }}>
                    ⏰ Peak Hour Slot
                  </button>
                  <button type="submit" className="btn btn-accent" style={{ padding: '0.5rem', fontSize: '0.85rem', flex: 1 }} disabled={scheduling}>
                    {scheduling ? 'Scheduling...' : '📅 Queue Post'}
                  </button>
                </div>

                {scheduleSuccess && (
                  <div style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: '600', textAlign: 'center' }}>
                    ✓ Scheduled successfully in Queue!
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* PDF Slide / Carousel specification generator */}
      {output && (
        <div className="card-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: '700' }}>Structured PDF Carousel Slide Layout</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Convert this post into a high-dwell-time multi-slide layout to boost LinkedIn distribution.
              </p>
            </div>
            
            <button 
              className="btn btn-outline" 
              onClick={generateSlidesLayout}
              disabled={generatingSlides}
            >
              {generatingSlides ? 'Generating Slides...' : '🎨 Generate Slide Layout'}
            </button>
          </div>

          {generatingSlides && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', animation: 'pulse 1s infinite' }}>
              Converting commentary text into visual slide panels...
            </div>
          )}

          {slides.length > 0 && (
            <div className="carousel-preview-container">
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                <button 
                  className="btn btn-primary" 
                  onClick={downloadCarouselPDF}
                  style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem' }}
                >
                  📥 Download Carousel as PDF
                </button>
                <button 
                  className="btn btn-outline" 
                  onClick={copySlidesText}
                  style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem' }}
                >
                  📋 Copy All Slide Text
                </button>
              </div>

              <div className="slide-deck">
                {slides.map(slide => (
                  <div key={slide.slideNumber} className="slide-card">
                    <div className="slide-card-header">
                      <span className="slide-card-number">SLIDE {slide.slideNumber}</span>
                      <button 
                        className="btn-slide-copy"
                        onClick={(e) => {
                          e.stopPropagation();
                          copySingleSlide(slide);
                        }}
                        title="Copy text of this slide"
                      >
                        📋 Copy
                      </button>
                    </div>
                    
                    <div className="slide-card-body">
                      {slide.title && (
                        <div className="slide-card-title">
                          {slide.title}
                        </div>
                      )}

                      {slide.image ? (
                        <div className="slide-card-image-container">
                          <img src={slide.image} className="slide-card-image" alt="slide visual" />
                          <button
                            className="btn-slide-image-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateSlideImage(slide.slideNumber, undefined);
                            }}
                            title="Remove image"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="slide-card-image-placeholder">
                          <span>No Graphic Selected</span>
                        </div>
                      )}
                      
                      <p className="slide-card-text">{slide.content}</p>
                    </div>

                    <div className="slide-card-controls">
                      <label className="btn-slide-control">
                        📷 Upload
                        <input 
                          type="file" 
                          accept="image/*" 
                          style={{ display: 'none' }} 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleSlideImageUpload(slide.slideNumber, file);
                          }}
                        />
                      </label>
                      
                      <select
                        className="select-slide-control"
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'auto') {
                            applyAutoSearchImage(slide);
                          } else if (['database', 'circuits', 'code', 'network', 'charts'].includes(val)) {
                            const base64 = generateTechVectorGraphic(val);
                            updateSlideImage(slide.slideNumber, base64);
                          }
                          e.target.value = ''; // reset
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>✨ Visuals</option>
                        <option value="auto">🧠 Auto-Suggest</option>
                        <option value="database">🗄️ Database</option>
                        <option value="circuits">⚡ Circuits</option>
                        <option value="code">💻 Code Editor</option>
                        <option value="network">🌐 Neural Net</option>
                        <option value="charts">📊 Analytics</option>
                      </select>
                    </div>

                    <div className="slide-card-footer">
                      <span className="slide-card-index">{slide.slideNumber} / {slides.length}</span>
                      <span className="slide-card-handle" title={profile?.linkedinUrl || profile?.githubUrl || profile?.name}>
                        {profile?.linkedinUrl 
                          ? `@${profile.linkedinUrl.replace(/https?:\/\/(www\.)?/, '').replace(/\/$/, '').split('/').pop()}` 
                          : profile?.githubUrl 
                            ? `gh/${profile.githubUrl.replace(/https?:\/\/(www\.)?/, '').replace(/\/$/, '').split('/').pop()}`
                            : profile?.name.split(' ')[0]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Style Variants Panel */}
      {variants.length > 0 && (
        <div className="card-panel">
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1rem' }}>Other Autopilot Candidates</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {variants.map(v => (
              <div key={v.style} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: '700', textTransform: 'uppercase', fontSize: '0.85rem', color: '#3b82f6' }}>{v.style} variant</span>
                  {v.score && (
                    <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '2px 8px', borderRadius: '50px', fontSize: '0.8rem', fontWeight: '700' }}>
                      Score: {v.score.totalScore.toFixed(1)}/10
                    </span>
                  )}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>{v.content}</p>
                <button 
                  className="btn btn-outline" 
                  onClick={() => setOutput(v.content)}
                  style={{ marginTop: '1rem', padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                >
                  Promote to Main Draft
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}