// Test file for call graph analysis
function testFunction1() {
  testFunction2();
  console.log('test');
}

function testFunction2() {
  const result = testFunction3();
  return result;
}

function testFunction3() {
  return 'hello world';
}

// External library call
function externalCall() {
  JSON.stringify({ test: true });
  Math.random();
}

// Async function with await
async function asyncFunction() {
  await Promise.resolve();
  testFunction1();
}

// Method call
class TestClass {
  method1() {
    this.method2();
  }

  method2() {
    testFunction1();
  }
}

export { testFunction1, TestClass };