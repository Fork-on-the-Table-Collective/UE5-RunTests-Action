const core = require("@actions/core");
const fs = require("fs").promises;
const fs2 = require("fs");
const readline = require("readline");
const execSync = require("child_process").execSync;

const readAndParseFile = async (filePath) => {
  const lines = [];
  const fileStream = fs2.createReadStream(filePath);
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

const getAllTests = async (TestListFile, TestList) => {
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

const loadJSON = async (jsonFilePath) => {
  try {
    const data = await fs.readFile(jsonFilePath, "utf8");
    const obj = JSON.parse(cleanString(data));
    return obj;
  } catch (error) {
    console.error("Error loading or parsing JSON:", error);
    throw error;
  }
};

const runTest = async (
  EnginePath,
  uprojectFile,
  test,
  currentPath,
  result,
  isLast = false
) => {
  console.log(`Running test: ${test}`);
  const logfile = currentPath + "\\test_results\\index.json";
  let isError = false;
  try {
    const cmd = command(EnginePath, uprojectFile, test, currentPath);
    execSync(cmd);
    const obj = await loadJSON(logfile);

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
    if (isLast) {
      result.summary.failedTestset.push(test);
    }
    isError = true;
  }
  return isError;
};

const main = async () => {
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
    const AllTests = await getAllTests(TestListFile, TestList);
    const MainTests = Object.keys(AllTests);
    // await Promise.all(
    MainTests.map(
      async (MainTest) => {
        if (
          await runTest(EnginePath, uprojectFile, MainTest, currentPath, result)
        ) {
          const SubTests = Object.keys(AllTests[MainTest]);
          // await Promise.all(
          SubTests.map(async (SubTest) => {
            if (
              await runTest(
                EnginePath,
                uprojectFile,
                SubTest,
                currentPath,
                result
              )
            ) {
              const ElementaryTests = AllTests[MainTest][SubTest];
              // await Promise.all(
              ElementaryTests.map(async (ElementaryTest) => {
                await runTest(
                  EnginePath,
                  uprojectFile,
                  ElementaryTest,
                  currentPath,
                  result,
                  true
                );
              });
              // );
            }
          });
          // );
        }
      }
      // })
    );
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
