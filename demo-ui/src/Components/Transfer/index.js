import React from 'react';

import './index.css';

function Transfer({ users, updateLoader, erc20Address }) {
  const [transferValue, setTransferValue] = React.useState();
  const [recipient, setRecipient] = React.useState('');
  const [offchain, setOffchain] = React.useState(false);
  const currentUser = users.find(user => user.isCurrent);
  function doTransfer(e) {
    e.preventDefault();

    if (!users[0] || !currentUser) return;
    if (recipient === '') return;

    updateLoader(true);
    const { nf3Object } = currentUser;

    nf3Object
      .transfer(
        offchain,
        erc20Address,
        'ERC20',
        Number(transferValue),
        '0x00',
        users[Number(recipient)].nf3Object.zkpKeys.compressedZkpPublicKey,
      )
      .then(() => updateLoader(false))
      .catch(err => {
        console.log(err);
        updateLoader(false);
      });
    setTransferValue('');
    setRecipient('');
  }

  return (
    <main style={{ marginTop: '158px' }}>
      <div className="container pt-4">
        <form className="form">
          <div className="form-group form-custom-field">
            <text>
              The fees will be paid <strong>on top</strong> of the transfer value you set here, so
              make sure to have enough balance to cover both the transfer and the fee.
              <br />
              <br />
            </text>
            <input
              type="number"
              className="form-control"
              placeholder="Tranfer Value"
              value={transferValue}
              onChange={e => setTransferValue(e.target.value)}
            />
          </div>
          <div className="form-group form-custom-field">
            <select
              className="form-select"
              aria-label="Default select example"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
            >
              <option value="">Select Recipient</option>
              <option value="0">{users[0] && users[0].name}</option>
              <option value="1">{users[1] && users[1].name}</option>
            </select>
          </div>
          <div className="form-group form-custom-field">
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="offchainTransfer"
                checked={offchain}
                onChange={e => setOffchain(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="offchainTransfer">
                Offchain (instant transfer)
              </label>
            </div>
          </div>
          <div className="form-group form-custom-field">
            <button type="button" className="btn btn-primary" onClick={doTransfer}>
              Transfer
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default Transfer;
