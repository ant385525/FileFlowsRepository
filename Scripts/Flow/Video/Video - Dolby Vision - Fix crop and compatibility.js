/**
 * @name Video - Dolby Vision - Fix crop and compatibility
 * @description Converts to the most compatibile profile 8.1 and removing bad crop data.
Run between encode and move/replace.
Output is always an MKV.
dovi_tool only supports HEVC when AV1 support is added I will updated this script.
 * @author Lawrence Curtis
 * @revision 1
 * @param {bool} RemoveHDRTenPlus Remove HDR10+, this fixes the black screen issues on FireStick
 * @output Fixed
 * @output No fix required
 * @minimumVersion 24.09.2.3553
 */
function Script(RemoveHDRTenPlus) {
  const duration = Variables.vi.Duration;
  const videoStreams = Variables.vi.VideoInfo.VideoStreams;

  if (!(videoStreams?.length > 0 && videoStreams[0].DolbyVision)) {
    Logger.ELog("No Dolby Vision detected");
    return 2;
  }

  if (!(videoStreams[0].Codec == "hevc")) {
    Logger.ELog(
      "Video format MUST be HEVC, AV1 is not currently supported by dovi_tool"
    );
    return 2;
  }

  Flow.AdditionalInfoRecorder("DoVi", "Initializing", 1);

  let dovi_tool = ToolPath("dovi_tool");
  if (!dovi_tool) return -1;

  let mkvmerge = ToolPath("mkvmerge");
  if (!mkvmerge) return -1;

  let mkvinfo = ToolPath("mkvinfo");
  if (!mkvinfo) return -1;

  let ffmpeg = ToolPath("ffmpeg");
  if (!ffmpeg) return -1;

  let working = Flow.WorkingFile;
  let original = Variables.file.Orig.FullName;

  Flow.AdditionalInfoRecorder("DoVi", "Extracting HEVC bitstream", 1);

  var executeArgs = new ExecuteArgs();

  executeArgs.command = ffmpeg;
  executeArgs.argumentList = [
    "-i",
    original,
    "-c:v",
    "copy",
    "-bsf:v",
    "hevc_mp4toannexb",
    "-f",
    "hevc",
    Flow.TempPath + "/original.hevc",
  ];

  executeArgs.add_Error((line) => {
    let matches = line.match(/time=([\.:0-9]+)/i);
    if (matches) {
      ffPercent(duration, matches[1]);
    }
  });

  let process = Flow.Execute(executeArgs);

  if (process.exitCode !== 0) {
    Logger.ELog("Failed to extract HEVC: " + process.output);
    return -1;
  }

  Flow.PartPercentageUpdate(0);
  Flow.AdditionalInfoRecorder("DoVi", "Extracting RPU", 1);

  // Creating RPU 8.1 file
  var executeArgs = new ExecuteArgs();
  executeArgs.command = dovi_tool;
  executeArgs.argumentList = [
    "--crop",
    "--mode",
    "2",
    "extract-rpu",
    "-o",
    `${Flow.TempPath}/original.rpu`,
    `${Flow.TempPath}/original.hevc`,
  ];

  if (RemoveHDRTenPlus) {
    executeArgs.argumentList = ["--drop-hdr10plus"].concat(
      executeArgs.argumentList
    );
  }

  if (!Flow.IsWindows) {
    let args = executeArgs.argumentList.join(" ");
    executeArgs.argumentList = ["-qefc", dovi_tool + " " + args, "/dev/null"];
    executeArgs.command = "script";
  }

  executeArgs.add_Output((line) => {
    let matches = line.match(/ ([0-9]+)%/i);
    if (matches) {
      Flow.PartPercentageUpdate(matches[1]);
    } else {
      Flow.AdditionalInfoRecorder("DoVi", line.replace(/\[2K/, ""), 1);
    }
  });

  process = Flow.Execute(executeArgs);

  if (process.exitCode !== 0) {
    Logger.ELog("Failed to dovi_tool extract: " + process.output);
    return -1;
  }

  // Remove temp files
  System.IO.File.Delete(Flow.TempPath + "/original.hevc");

  Flow.PartPercentageUpdate(0);
  Flow.AdditionalInfoRecorder("DoVi", "Extracting converted video", 1);

  var executeArgs = new ExecuteArgs();

  executeArgs.command = ffmpeg;
  executeArgs.argumentList = [
    "-i",
    working,
    "-c:v",
    "copy",
    Flow.TempPath + "/converted_video.hevc",
  ];

  executeArgs.add_Error((line) => {
    let matches = line.match(/time=([\.:0-9]+)/i);
    if (matches) {
      ffPercent(duration, matches[1]);
    }
  });

  Flow.Execute(executeArgs);

  if (process.exitCode !== 0) {
    Logger.ELog("Failed to extract working video: " + process.exitCode);
    return -1;
  }

  Flow.PartPercentageUpdate(0);
  Flow.AdditionalInfoRecorder("DoVi", "Replacing RPU", 1);

  // Inject original RPU and remove crop
  var executeArgs = new ExecuteArgs();
  executeArgs.command = dovi_tool;
  executeArgs.argumentList = [
    "--crop",
    "--mode",
    "2",
    "inject-rpu",
    "--rpu-in",
    Flow.TempPath + "/original.rpu",
    "--input",
    Flow.TempPath + "/converted_video.hevc",
    "--output",
    Flow.TempPath + "/fixed.hevc",
  ];

  if (RemoveHDRTenPlus) {
    executeArgs.argumentList = ["--drop-hdr10plus"].concat(
      executeArgs.argumentList
    );
  }

  if (!Flow.IsWindows) {
    let args = executeArgs.argumentList.join(" ");
    executeArgs.argumentList = ["-qefc", dovi_tool + " " + args, "/dev/null"];
    executeArgs.command = "script";
  }

  executeArgs.add_Output((line) => {
    let matches = line.match(/ ([0-9]+)%/i);
    if (matches) {
      Flow.PartPercentageUpdate(matches[1]);
    } else {
      Flow.PartPercentageUpdate(0);
      Flow.AdditionalInfoRecorder("DoVi", line.replace(/\[2K/, ""), 1);
    }
  });

  process = Flow.Execute(executeArgs);

  if (process.exitCode !== 0) {
    Logger.ELog("Failed to dovi_tool: " + process.exitCode);
    return -1;
  }

  System.IO.File.Delete(Flow.TempPath + "/converted_video.hevc");
  System.IO.File.Delete(Flow.TempPath + "/original.rpu");

  // Check framerate of video
  process = Flow.Execute({
    command: mkvinfo,
    argumentList: [working],
  });

  const regexp = /([\.0-9]+) frames\/fields/i;
  const matches = process.standardOutput.match(regexp);
  var executeArgs = new ExecuteArgs();

  executeArgs.command = mkvmerge;
  executeArgs.argumentList = [
    "-o",
    Flow.TempPath + "/converted.mkv",
    Flow.TempPath + "/fixed.hevc",
    "-D",
    working,
    "--track-order",
    "1:0",
  ];

  if (matches) {
    executeArgs.argumentList = [
      "--default-duration",
      `0:${matches[1]}fps`,
      "--fix-bitstream-timing-information",
      "0",
    ].concat(executeArgs.argumentList);
  }

  executeArgs.add_Output((line) => {
    let matches = line.match(/ ([0-9]+)%/i);
    if (matches) {
      Flow.PartPercentageUpdate(matches[1]);
    }
  });

  Flow.PartPercentageUpdate(0);
  Flow.AdditionalInfoRecorder("DoVi", "Finishing", 1);
  process = Flow.Execute(executeArgs);

  if (process.exitCode !== 0) {
    Logger.ELog("Failed to mux: " + process.exitCode);
    return -1;
  }

  System.IO.File.Delete(Flow.TempPath + "/fixed.hevc");
  Flow.SetWorkingFile(Flow.TempPath + "/converted.mkv");

  return 1;
}

function ToolPath(tool) {
  if (Flow.IsDocker) {
    let process = Flow.Execute({
      command: "which",
      argumentList: [tool],
    });

    if (process.exitCode == 0) return process.output.replace(/\n/, "");

    Logger.ELog(`Please install both the MKVToolNix and dovi_tool DockerMods`);
    return null;
  }

  let toolPath = Flow.GetToolPath(tool);

  if (toolPath) return toolPath;

  Logger.ELog(
    `${tool} cannot be found! Please create a Variable called "${tool}" that points too the correct location, please see ffmpeg as an example`
  );
}

function humanTimeToSeconds(text) {
  const parts = text.split(":").map((p) => parseFloat(p));

  let time = 0;
  time += parts.pop(); //s
  time += parts.pop() * 60; //m
  time += parts.pop() * 60 * 60; //h

  return time;
}

function ffPercent(duration, text) {
  Flow.PartPercentageUpdate((100 / duration) * humanTimeToSeconds(text));
}