// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice ERC-8183 hook interface. A job's hook is called around each hookable
/// core function; `selector` names the function and `data` carries its arguments.
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
