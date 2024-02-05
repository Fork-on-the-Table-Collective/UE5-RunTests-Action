const core = require("@actions/core");
const fs = require("fs");
const readline = require("readline");
const execSync = require("child_process").execSync;

const readAndParseFile = async (filePath) => {
  const lines = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity, // To handle both \r\n and \n line endings
  });
  for await (const line of rl) {
    const values = line.split(",");
    lines.push(values);
  }
  return lines;
};

const readAndParseString = (testlistString) => {
  const lines = [];
  for (const line of testlistString.split("\n")) {
    const values = line.split(",");
    lines.push(values);
  }
  return lines;
};

const createTestObject = (AllTests, subtests, line) => {
  if (!AllTests.hasOwnProperty(line[0])) {
    subtests = {};
  }
  subtests.hasOwnProperty(line[0] + "." + line[1])
    ? subtests[line[0] + "." + line[1]].push(line.join("."))
    : (subtests[line[0] + "." + line[1]] = [line.join(".")]);
  AllTests[line[0]] = subtests;
};

const getAllTests = (TestListFile, TestList) => {
  let AllTests = {};
  let subtests = {};
  //   if (TestListFile) {
  //     (await readAndParseFile(TestListFile)).forEach((line) => {
  //       createTestObject(AllTests, subtests, line);
  //     });
  //   } else
  if (TestList) {
    readAndParseString(TestList).forEach((line) => {
      createTestObject(AllTests, subtests, line);
    });
  }
  return AllTests;
};

const command = (EnginePath, uprojectFile, test, currentPath) => {
  return `"${EnginePath}\\Engine\\Binaries\\Win64\\UnrealEditor.exe" "${uprojectFile}" -ExecCmds="Automation RunTest ${test};quit" -TestExit="Automation Test Queue Empty" -log -nosplash -Unattended -nopause -NullRHI -ReportOutputPath="${currentPath}\\test_results"`;
};

const cleanString = (input) => {
  var output = "";
  for (var i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) <= 127) {
      output += input.charAt(i);
    }
  }
  return output;
};

const loadJSON = (jsonFilePath) => {
  try {
    const data = fs.readFileSync(jsonFilePath, "utf8");
    const obj = JSON.parse(cleanString(data));
    return obj;
  } catch (error) {
    console.error("Error loading or parsing JSON:", error);
    throw error;
  }
};
const runTest = (
  EnginePath,
  uprojectFile,
  currentPath,
  test,
  Subtests,
  result
) => {
  console.log(`Running test: ${test}`);
  Console.log();
  const logfile = currentPath + "\\test_results\\index.json";
  try {
    const cmd = command(EnginePath, uprojectFile, test, currentPath);
    execSync(cmd);
    const obj = loadJSON(logfile);

    result[test] = {
      succeeded: obj.succeeded,
      succeededWithWarnings: obj.succeededWithWarnings,
      failed: obj.failed,
      notRun: obj.notRun,
      inProcess: obj.inProcess,
      errors: JSON.stringify(
        obj.tests.filter((test) => test.state !== "Success"),
        null,
        2
      ),
    };

    result.summary.succeeded += result[test].succeeded;
    result.summary.succeededWithWarnings += result[test].succeededWithWarnings;
    result.summary.failed += result[test].failed;
    result.summary.notRun += result[test].notRun;
    result.summary.inProcess += result[test].inProcess;
  } catch (error) {
    result[test] = {
      errors: `Error executing Test: ${test}. Message: ${error.message}`,
    };
    console.log(`Error executing Test: ${test}. Message: ${error.message}`);
    
    if (Subtests === "") {
      result.summary.failedTestset.push(test);
    } else {
      const SubTestList = Array.isArray(Subtests)
        ? Subtests
        : Object.keys(Subtests);
      SubTestList.foreach((SubTest) => {
        console.log(`Subtests: ${SubTestList}, Subtest:${SubTest}`);
        runTest(
          EnginePath,
          uprojectFile,
          currentPath,
          SubTest,
          Array.isArray(Subtests) ? "" : Subtests[SubTest],
          result
        );
      });
    }
  }
};

const main = () => {
  const EnginePath = core.getInput("EnginePath");
  const uprojectFile = core.getInput("uprojectFile");
  const TestListFile = core.getInput("TestListFile");
  const TestList = core.getInput("TestList");
  const currentPath = process.cwd();
  const result = {
    summary: {
      succeeded: 0,
      succeededWithWarnings: 0,
      failed: 0,
      notRun: 0,
      inProcess: 0,
      errors: [],
      failedTestset: [],
    },
  };
  try {
    const AllTests = getAllTests(TestListFile, TestList);
    const MainTests = Object.keys(AllTests);
    MainTests.foreach((MainTest) => {
      runTest(
        EnginePath,
        uprojectFile,
        currentPath,
        MainTest,
        AllTests[MainTest],
        result
      );
    });
    if (result.summary.failed > 0 || result.summary.failedTestset.length > 0) {
      core.setFailed(`Some tests failed. ${JSON.stringify(result, null, 2)}`);
    } else if (result.summary.failedTestset.length > 0) {
      core.setFailed(
        `Some tests run into error. ${JSON.stringify(result, null, 2)}`
      );
    } else {
      console.log(JSON.stringify(result.summary, null, 2));
      core.setOutput("summary", JSON.stringify(result.summary, null, 2));
    }
  } catch (error) {
    core.setFailed(error.message);
  }
  console.log("Job finished");
};

main();
